import { APP_NAME, APP_VERSION, REQUIREMENTS_VERSION } from "@rundflug/config";
import { gateDisplayFilterSchema } from "@rundflug/contracts";
import {
  assessForecastFreshness,
  assessMarginalProductCapacity,
  createQueueAvailability,
  deriveResourceGroupCapacity,
  estimateDuration,
  forecastQueueWindows,
  formatFlightGroupLabel,
  resolveTurnaroundProfile,
} from "@rundflug/domain";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { registerAdminAccountRoutes } from "./admin-account-routes";
import { registerAdminEventCloneRoutes } from "./admin-event-clone-routes";
import { registerAdminEventDeletionRoutes } from "./admin-event-deletion-routes";
import { registerAdminEventLogoRoutes } from "./admin-event-logo-routes";
import { registerAdminEventRoutes } from "./admin-event-routes";
import { registerAdminMasterDataTemplateRoutes } from "./admin-master-data-template-routes";
import { registerAdminSecurityRoutes } from "./admin-security-routes";
import { expireAnalysisArchives, processPendingAnalysisArchives } from "./analysis-archive";
import { registerAnalysisControlRoutes } from "./analysis-control-routes";
import { authorizeSession, type SessionActor } from "./auth";
import { registerAuthRoutes } from "./auth-routes";
import { createPortableBackup, operationDateInTimeZone } from "./backup";
import { withBookingGroupPartProjection } from "./booking-group-part-projection";
import { registerControlCoordinationRoutes } from "./control-coordination-routes";
import { registerControlSessionMiddleware } from "./control-session-middleware";
import { runD1ReadsSequentially } from "./d1-read-scheduler";
import { authorizeDevice } from "./device-authorization";
import { EventCoordinator } from "./event-coordinator";
import { registerFactoryResetRoutes } from "./factory-reset-routes";
import { registerFidsControlRoutes } from "./fids-control-routes";
import {
  EMPTY_GATE_DISPLAY_FILTER_JSON,
  withGateDisplayFilterFallback,
} from "./gate-display-filter-storage";
import { registerHistoryRoutes } from "./history-routes";
import { allowUnknownTicketAttempt } from "./public-access";
import { registerPublicBoardRoutes } from "./public-board-routes";
import { registerPublicInstallRoutes } from "./public-install-routes";
import { registerPublicLogoRoutes } from "./public-logo-routes";
import { registerPublicPushRoutes } from "./public-push-routes";
import {
  activeTicketGroupRecallProjection,
  predictedBoardingWindow,
} from "./public-status-projection";
import { registerPublicStatusRoutes } from "./public-status-routes";
import { registerReportExportRoutes } from "./report-export-routes";
import { limitApiBody, requireValidJsonBody } from "./request-body-boundaries";
import { registerSetupRoutes } from "./setup-routes";
import { registerSimulationPlanExportRoutes } from "./simulation-plan-export-routes";
import { rowToSnapshot } from "./snapshot";
import { registerTicketReadRoutes } from "./ticket-read-routes";
import { httpsRedirectLocation } from "./transport-security";
import type { Env, StoredEventRow } from "./types";
import { purgeExpiredPushSubscriptions } from "./web-push";

const app = new Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>();

function eventRoutes<const Suffix extends string>(
  suffix: Suffix,
): [`/api/control/:eventId${Suffix}`] {
  const controlPath = `/api/control/:eventId${suffix}` as `/api/control/:eventId${Suffix}`;
  return [controlPath];
}

app.use("*", async (context, next) => {
  const redirectLocation = httpsRedirectLocation(context.req.url, context.env.APP_ENV);
  if (redirectLocation) return context.redirect(redirectLocation, 308);
  await next();
});

async function unknownTicketResponse(env: Env, request: Request): Promise<Response> {
  if (!(await allowUnknownTicketAttempt(env.PUBLIC_TICKET_RATE_LIMITER, request))) {
    return Response.json(
      { error: { code: "TOO_MANY_TICKET_ATTEMPTS", message: "Bitte später erneut versuchen." } },
      { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } },
    );
  }
  return Response.json(
    { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

function eventCoordinatorNamespace(env: Env): Env["EVENT_COORDINATOR"] {
  // workerd/miniflare does not implement jurisdiction restrictions locally.
  // Acceptance and production always request the EU jurisdiction explicitly.
  return env.APP_ENV === "development"
    ? env.EVENT_COORDINATOR
    : env.EVENT_COORDINATOR.jurisdiction("eu");
}

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: "no-referrer",
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
  }),
);

app.use("/api/*", async (context, next) => {
  await next();
  context.header("cache-control", "no-store");
});

app.use("/api/*", limitApiBody);
app.use("/api/*", requireValidJsonBody);

registerControlSessionMiddleware(app);

app.get("/api/health", (context) =>
  context.json({
    ok: true,
    service: APP_NAME,
    applicationVersion: APP_VERSION,
    environment: context.env.APP_ENV,
    requirementsVersion: REQUIREMENTS_VERSION,
    timestamp: new Date().toISOString(),
  }),
);

app.get("/api/meta", (context) =>
  context.json({
    applicationVersion: APP_VERSION,
    architecture: "Cloudflare Worker + Static Assets + D1 + Durable Object + R2",
    dataJurisdiction: context.env.DATA_JURISDICTION,
    productionReady: false,
    requirementsVersion: REQUIREMENTS_VERSION,
    sourceRevision: context.env.SOURCE_REVISION?.trim() || "unknown",
  }),
);

registerSetupRoutes(app);

registerAuthRoutes(app);
registerAdminAccountRoutes(app);
registerAdminSecurityRoutes(app);
registerAdminEventRoutes(app);
registerFactoryResetRoutes(app);

registerAdminMasterDataTemplateRoutes(app);

registerSimulationPlanExportRoutes(app);

registerAdminEventCloneRoutes(app);

registerAdminEventDeletionRoutes(app);

registerAdminEventLogoRoutes(app);

registerPublicLogoRoutes(app);

registerControlCoordinationRoutes(app, eventCoordinatorNamespace);

registerFidsControlRoutes(app, eventCoordinatorNamespace);

app.on("GET", eventRoutes("/operations"), async (context) => {
  const requestStartedAt = performance.now();
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(
    context.env,
    eventId,
    context.req.raw,
    context.get("sessionActor"),
  );
  if (!device || device.role === "DISPLAY") {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }

  const eventRow = await context.env.DB.prepare(
    `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
            emergency_mode, operational_interrupted, version,
            operational_note, operations_start_at, operations_end_at, sale_opens_at,
            no_show_after_minutes,
            max_ticket_deferrals,
            notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
            automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
            precall_min_quality, precall_gate_cooldown_minutes,
            heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
            planned_buffer_minutes, logo_object_key, logo_dark_object_key, updated_at
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<StoredEventRow>();
  if (!eventRow) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const projectionReadAt = new Date().toISOString();

  const [
    products,
    aircraftProductTurnaroundOverrideRows,
    rotations,
    queueGroupRows,
    dispatchLeaseRows,
    durationRows,
    aircraftRows,
    fleetRows,
    pilotRows,
    gatesRows,
    resourceGroupRows,
    plannedOperationRows,
    recurringRuleRows,
    metricsRow,
  ] = await runD1ReadsSequentially([
    () =>
      context.env.DB.prepare(
        `SELECT p.id, p.code, p.name, p.public_description, p.resource_group_id, rg.name AS resource_group_name,
              rg.status AS resource_group_status, rg.operational_note AS resource_group_operational_note,
              p.price_cents, p.sale_enabled, p.reference_capacity, p.reference_duration_minutes,
              p.promised_flight_minutes,
              p.planned_boarding_minutes_override, p.planned_deboarding_minutes_override,
              p.planned_buffer_minutes_override,
              p.sale_closes_at, p.capacity_warning_threshold, p.capacity_critical_threshold,
              p.child_companion_required, p.weight_classes_json, p.sort_order, p.gate_id,
              g.label AS gate_label,
              COUNT(CASE WHEN t.status = 'QUEUED' THEN 1 END) AS queued_tickets,
              (SELECT COUNT(*) FROM tickets shared_t
                JOIN ticket_groups shared_tg ON shared_tg.id = shared_t.ticket_group_id
                JOIN products shared_p ON shared_p.id = shared_tg.product_id
               WHERE shared_p.resource_group_id = p.resource_group_id
                 AND shared_t.status = 'QUEUED') AS resource_group_open_tickets
         FROM products p
         JOIN resource_groups rg ON rg.id = p.resource_group_id
         JOIN gates g ON g.id = p.gate_id
         LEFT JOIN ticket_groups tg ON tg.product_id = p.id
         LEFT JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE p.operation_day_id = ?1
        GROUP BY p.id
        ORDER BY p.sort_order, p.name, p.id`,
      )
        .bind(eventId)
        .all<{
          id: string;
          code: string;
          name: string;
          public_description: string;
          resource_group_id: string;
          resource_group_name: string;
          resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
          resource_group_operational_note: string;
          price_cents: number;
          gate_id: string;
          gate_label: string;
          child_companion_required: number;
          weight_classes_json: string;
          sort_order: number;
          sale_enabled: number;
          reference_capacity: number;
          reference_duration_minutes: number;
          promised_flight_minutes: number;
          planned_boarding_minutes_override: number | null;
          planned_deboarding_minutes_override: number | null;
          planned_buffer_minutes_override: number | null;
          queued_tickets: number;
          resource_group_open_tickets: number;
          sale_closes_at: string | null;
          capacity_warning_threshold: number;
          capacity_critical_threshold: number;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT aircraft_id, product_id, planned_boarding_minutes_override,
                planned_deboarding_minutes_override, planned_buffer_minutes_override, version
           FROM aircraft_product_turnaround_overrides
          WHERE operation_day_id = ?1
          ORDER BY product_id, aircraft_id`,
      )
        .bind(eventId)
        .all<{
          aircraft_id: string;
          product_id: string;
          planned_boarding_minutes_override: number | null;
          planned_deboarding_minutes_override: number | null;
          planned_buffer_minutes_override: number | null;
          version: number;
        }>(),
    () =>
      context.env.DB.prepare(
        withBookingGroupPartProjection(
          `SELECT r.id, r.version, r.flight_group_id, fg.resource_group_id,
              rotation_rg.short_code AS resource_group_short_code, fg.communication_number,
              COALESCE(fg.queue_position, fg.communication_number) AS queue_position,
              r.status, r.aircraft_id, r.usable_capacity, fg.precalled_at,
              fg.precall_decision_status, fg.precall_decision_reason,
              fg.precall_dispatch_reason,
              fg.precall_decision_at, fg.precall_predicted_boarding_at,
              fg.precall_adaptive_lead_minutes, fg.precall_gate_id,
              fg.precall_adaptive_base_lead_minutes,
              fg.precall_gate_travel_lead_minutes, fg.precall_effective_lead_minutes,
              fg.precall_boarding_window_lower_at, fg.precall_boarding_window_upper_at,
              COALESCE(r.gate_id, MIN(p.gate_id), '') AS gate_id,
              COALESCE(MAX(rotation_gate.label), MIN(product_gate.label), '') AS gate_label,
              r.operational_note,
              r.called_at, r.departed_at, r.landed_at, r.completed_at,
              r.planned_boarding_at, r.planned_departure_at, r.planned_landing_at,
              r.planned_completion_at, r.predicted_boarding_at, r.predicted_departure_at,
              r.predicted_landing_at, r.predicted_completion_at, r.prediction_quality,
              r.prediction_lower_minutes, r.prediction_upper_minutes, r.prediction_updated_at,
              r.forecast_assumed_aircraft_id, r.turnaround_boarding_minutes,
              r.dispatch_plan_id, r.dispatch_plan_revision, r.dispatch_batch_id,
              (SELECT snapshot.operation_day_version
                 FROM forecast_snapshots snapshot
                WHERE snapshot.rotation_id = r.id
                  AND snapshot.dispatch_plan_revision = r.dispatch_plan_revision
                ORDER BY snapshot.captured_at DESC, snapshot.id DESC
                LIMIT 1) AS dispatch_operation_day_version,
              r.dispatch_order, r.dispatch_wave, r.dispatch_lane_id,
              r.dispatch_group_ids_json, r.dispatch_occupied_seats,
              r.dispatch_available_seats, r.dispatch_commitment_level,
              r.dispatch_decision_reasons_json, r.dispatch_confirmed_overtake_count,
              r.dispatch_projected_overtake_count,
              r.dispatch_unplanned_reason,
              r.turnaround_deboarding_minutes, r.turnaround_buffer_minutes,
              r.turnaround_boarding_source, r.turnaround_deboarding_source,
              r.turnaround_buffer_source,
              a.registration AS aircraft_registration,
              r.pilot_id, assigned_pilot.operational_code AS pilot_operational_code,
              (SELECT available_pilot.id FROM pilots available_pilot
                WHERE available_pilot.operation_day_id = r.operation_day_id
                  AND available_pilot.active = 1 AND available_pilot.paused = 0
                  AND NOT EXISTS (
                    SELECT 1 FROM rotations pilot_rotation
                     WHERE pilot_rotation.operation_day_id = r.operation_day_id
                       AND pilot_rotation.pilot_id = available_pilot.id
                       AND pilot_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                  )
                ORDER BY available_pilot.operational_code LIMIT 1) AS suggested_pilot_id,
              (SELECT available_pilot.operational_code FROM pilots available_pilot
                WHERE available_pilot.operation_day_id = r.operation_day_id
                  AND available_pilot.active = 1 AND available_pilot.paused = 0
                  AND NOT EXISTS (
                    SELECT 1 FROM rotations pilot_rotation
                     WHERE pilot_rotation.operation_day_id = r.operation_day_id
                       AND pilot_rotation.pilot_id = available_pilot.id
                       AND pilot_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                  )
                ORDER BY available_pilot.operational_code LIMIT 1) AS suggested_pilot_operational_code,
              (SELECT candidate.id FROM resource_group_memberships membership
                JOIN aircraft candidate ON candidate.id = membership.aircraft_id
               WHERE membership.operation_day_id = r.operation_day_id
                 AND membership.resource_group_id = fg.resource_group_id
                 AND membership.active_until IS NULL
                 AND candidate.operational_state IN ('AVAILABLE', 'BOARDING', 'IN_FLIGHT', 'LANDED', 'TURNAROUND')
                 AND candidate.operational_interrupted = 0
                 AND candidate.passenger_seats >= (
                   SELECT COUNT(*) FROM rotation_tickets capacity_rt
                    WHERE capacity_rt.rotation_id = r.id AND capacity_rt.released_at IS NULL
                 )
               ORDER BY
                 CASE WHEN candidate.operational_state = 'AVAILABLE' THEN 0 ELSE 1 END,
                 COALESCE((
                   SELECT candidate_rotation.predicted_completion_at
                     FROM rotations candidate_rotation
                    WHERE candidate_rotation.operation_day_id = membership.operation_day_id
                      AND candidate_rotation.aircraft_id = candidate.id
                      AND candidate_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                    ORDER BY candidate_rotation.predicted_completion_at DESC
                    LIMIT 1
                 ), '9999-12-31T23:59:59.999Z'),
                 candidate.passenger_seats,
                 candidate.registration
               LIMIT 1) AS suggested_aircraft_id,
              (SELECT candidate.registration FROM resource_group_memberships membership
                JOIN aircraft candidate ON candidate.id = membership.aircraft_id
               WHERE membership.operation_day_id = r.operation_day_id
                 AND membership.resource_group_id = fg.resource_group_id
                 AND membership.active_until IS NULL
                 AND candidate.operational_state IN ('AVAILABLE', 'BOARDING', 'IN_FLIGHT', 'LANDED', 'TURNAROUND')
                 AND candidate.operational_interrupted = 0
                 AND candidate.passenger_seats >= (
                   SELECT COUNT(*) FROM rotation_tickets capacity_rt
                    WHERE capacity_rt.rotation_id = r.id AND capacity_rt.released_at IS NULL
                 )
               ORDER BY
                 CASE WHEN candidate.operational_state = 'AVAILABLE' THEN 0 ELSE 1 END,
                 COALESCE((
                   SELECT candidate_rotation.predicted_completion_at
                     FROM rotations candidate_rotation
                    WHERE candidate_rotation.operation_day_id = membership.operation_day_id
                      AND candidate_rotation.aircraft_id = candidate.id
                      AND candidate_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                    ORDER BY candidate_rotation.predicted_completion_at DESC
                    LIMIT 1
                 ), '9999-12-31T23:59:59.999Z'),
                 candidate.passenger_seats,
                 candidate.registration
               LIMIT 1) AS suggested_aircraft_registration,
              MIN(tg.id) AS ticket_group_id, MIN(tg.deferral_count) AS deferral_count,
              COUNT(rt.ticket_id) AS ticket_count,
              CASE
                WHEN COUNT(rt.ticket_id) = 0
                  OR SUM(CASE WHEN t.weight_class = 'NOT_CAPTURED' THEN 1 ELSE 0 END) > 0
                THEN NULL
                ELSE SUM(CASE t.weight_class
                  WHEN 'CHILD' THEN od.child_reference_weight_kg
                  WHEN 'NORMAL' THEN od.normal_reference_weight_kg
                  WHEN 'HEAVY' THEN od.heavy_reference_weight_kg
                  WHEN 'INDIVIDUAL' THEN t.individual_weight_kg
                  ELSE NULL
                END)
              END AS estimated_passenger_payload_kg,
              COALESCE(MIN(p.code), 'RUND') AS product_code,
              COALESCE(MIN(p.name), 'Rundflug') AS product_name,
              COALESCE(MIN(p.reference_duration_minutes), 20) AS reference_duration_minutes,
              COALESCE(a.passenger_seats, MIN(p.reference_capacity), rotation_rg.reference_capacity)
                AS baseline_capacity,
              (SELECT json_group_array(json_object(
                'id', attendance_ticket.id,
                'status', attendance_ticket.status,
                'attendanceStatus', attendance_ticket.attendance_status
              ))
                FROM rotation_tickets attendance_rt
                JOIN tickets attendance_ticket ON attendance_ticket.id = attendance_rt.ticket_id
               WHERE attendance_rt.rotation_id = r.id AND attendance_rt.released_at IS NULL) AS tickets_json
              ,(SELECT json_group_array(json_object(
                  'id', grouped_tickets.ticket_group_id,
                  'communicationNumber', grouped_tickets.communication_number,
                  'soldAt', grouped_tickets.sold_at,
                  'ticketCount', grouped_tickets.ticket_count,
                  'presentCount', grouped_tickets.present_count,
                  'partNumber', grouped_tickets.part_number,
                  'partCount', grouped_tickets.part_count
                ))
                  FROM (
                    SELECT grouped_ticket.ticket_group_id,
                           grouped_group.communication_number,
                           grouped_group.sold_at,
                           grouped_part.part_number,
                           grouped_part.part_count,
                           COUNT(*) AS ticket_count,
                           SUM(CASE WHEN grouped_ticket.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END)
                             AS present_count
                      FROM rotation_tickets grouped_rt
                      JOIN tickets grouped_ticket ON grouped_ticket.id = grouped_rt.ticket_id
                      JOIN ticket_groups grouped_group ON grouped_group.id = grouped_ticket.ticket_group_id
                      JOIN booking_group_parts grouped_part
                        ON grouped_part.ticket_group_id = grouped_ticket.ticket_group_id
                       AND grouped_part.rotation_id = grouped_rt.rotation_id
                     WHERE grouped_rt.rotation_id = r.id AND grouped_rt.released_at IS NULL
                     GROUP BY grouped_ticket.ticket_group_id, grouped_group.communication_number,
                              grouped_group.sold_at, grouped_part.part_number,
                              grouped_part.part_count
                  ) grouped_tickets) AS booking_groups_json
         FROM rotations r
         JOIN operation_days od ON od.id = r.operation_day_id
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rotation_rg ON rotation_rg.id = fg.resource_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
         LEFT JOIN pilots assigned_pilot ON assigned_pilot.id = r.pilot_id
         LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         LEFT JOIN tickets t ON t.id = rt.ticket_id
         LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         LEFT JOIN products p ON p.id = tg.product_id
         LEFT JOIN gates rotation_gate ON rotation_gate.id = r.gate_id
         LEFT JOIN gates product_gate ON product_gate.id = p.gate_id
        WHERE r.operation_day_id = ?1 AND r.status <> 'CANCELED'
        GROUP BY r.id
        ORDER BY CASE WHEN r.status = 'DRAFT' THEN 1 ELSE 0 END,
                 COALESCE(fg.queue_position, fg.communication_number), fg.communication_number`,
        ),
      )
        .bind(eventId)
        .all<{
          id: string;
          version: number;
          flight_group_id: string;
          resource_group_id: string;
          resource_group_short_code: string;
          communication_number: number;
          queue_position: number;
          status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
          precalled_at: string | null;
          precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
          precall_decision_reason:
            | "ELIGIBLE"
            | "DISABLED"
            | "OPERATIONS_BLOCKED"
            | "NOT_QUEUE_FRONT"
            | "ALREADY_PRECALLED"
            | "NO_FORECAST_CAPACITY"
            | "NO_FITTING_AIRCRAFT"
            | "TOO_EARLY"
            | null;
          precall_dispatch_reason:
            | "NOT_IN_NEAR_DISPATCH_BATCH"
            | "GATE_CAPACITY_COVERED"
            | "WAITING_FOR_PRODUCT_FAIRNESS"
            | "WAITING_FOR_FITTING_LANE"
            | "COMMITMENT_LOCKED"
            | "DISPATCH_PLAN_STALE"
            | null;
          precall_decision_at: string | null;
          precall_predicted_boarding_at: string | null;
          precall_adaptive_lead_minutes: number | null;
          precall_gate_id: string | null;
          precall_adaptive_base_lead_minutes: number | null;
          precall_gate_travel_lead_minutes: number | null;
          precall_effective_lead_minutes: number | null;
          precall_boarding_window_lower_at: string | null;
          precall_boarding_window_upper_at: string | null;
          gate_id: string;
          gate_label: string;
          operational_note: string;
          aircraft_id: string | null;
          aircraft_registration: string | null;
          pilot_id: string | null;
          pilot_operational_code: string | null;
          suggested_pilot_id: string | null;
          suggested_pilot_operational_code: string | null;
          suggested_aircraft_id: string | null;
          suggested_aircraft_registration: string | null;
          ticket_group_id: string;
          deferral_count: number;
          ticket_count: number;
          baseline_capacity: number;
          usable_capacity: number | null;
          estimated_passenger_payload_kg: number | null;
          product_code: string;
          product_name: string;
          reference_duration_minutes: number;
          called_at: string | null;
          departed_at: string | null;
          landed_at: string | null;
          completed_at: string | null;
          planned_boarding_at: string | null;
          planned_departure_at: string | null;
          planned_landing_at: string | null;
          planned_completion_at: string | null;
          predicted_boarding_at: string | null;
          predicted_departure_at: string | null;
          predicted_landing_at: string | null;
          predicted_completion_at: string | null;
          prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
          prediction_lower_minutes: number | null;
          prediction_upper_minutes: number | null;
          prediction_updated_at: string | null;
          forecast_assumed_aircraft_id: string | null;
          dispatch_plan_id: string | null;
          dispatch_plan_revision: string | null;
          dispatch_batch_id: string | null;
          dispatch_operation_day_version: number | null;
          dispatch_order: number | null;
          dispatch_wave: number | null;
          dispatch_lane_id: string | null;
          dispatch_group_ids_json: string;
          dispatch_occupied_seats: number | null;
          dispatch_available_seats: number | null;
          dispatch_commitment_level: "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE" | null;
          dispatch_decision_reasons_json: string;
          dispatch_confirmed_overtake_count: number;
          dispatch_projected_overtake_count: number;
          dispatch_unplanned_reason:
            | "NO_FORECAST_CAPACITY"
            | "WAITING_FOR_FITTING_LANE"
            | "WAITING_FOR_PRODUCT_FAIRNESS"
            | "NOT_IN_NEAR_DISPATCH_BATCH"
            | "COMMITMENT_LOCKED"
            | "ATTENDANCE_MISSING"
            | "ATTENDANCE_CLARIFICATION"
            | "UNKNOWN_RESOURCE_RETURN"
            | null;
          turnaround_boarding_minutes: number | null;
          turnaround_deboarding_minutes: number | null;
          turnaround_buffer_minutes: number | null;
          turnaround_boarding_source: string | null;
          turnaround_deboarding_source: string | null;
          turnaround_buffer_source: string | null;
          tickets_json: string;
          booking_groups_json: string;
        }>(),
    () =>
      context.env.DB.prepare(
        `WITH segment_stats AS (
           SELECT segment_ticket.ticket_group_id, segment_rotation.id AS rotation_id,
                  segment_rotation.status,
                  COALESCE(segment_group.queue_position, segment_group.communication_number)
                    AS segment_order,
                  segment_group.communication_number,
                  segment_group.precalled_at,
                  COUNT(*) AS ticket_count,
                  SUM(CASE WHEN segment_ticket.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END)
                    AS present_count
             FROM rotation_tickets segment_assignment
             JOIN tickets segment_ticket ON segment_ticket.id = segment_assignment.ticket_id
             JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
             JOIN flight_groups segment_group ON segment_group.id = segment_rotation.flight_group_id
            WHERE segment_assignment.released_at IS NULL
              AND segment_rotation.operation_day_id = ?1
              AND segment_rotation.status <> 'CANCELED'
            GROUP BY segment_ticket.ticket_group_id, segment_rotation.id, segment_rotation.status,
                     segment_group.queue_position, segment_group.communication_number,
                     segment_group.precalled_at
         ), ranked_segments AS (
           SELECT segment_stats.*,
                  ROW_NUMBER() OVER (
                    PARTITION BY ticket_group_id
                    ORDER BY segment_order, communication_number, rotation_id
                  ) AS segment_index,
                  COUNT(*) OVER (PARTITION BY ticket_group_id) AS segment_count
             FROM segment_stats
         ), next_draft_segments AS (
           SELECT ranked_drafts.*
             FROM (
               SELECT ranked_segments.*,
                      ROW_NUMBER() OVER (
                        PARTITION BY ticket_group_id ORDER BY segment_index
                      ) AS draft_rank
                 FROM ranked_segments
                WHERE status = 'DRAFT'
             ) ranked_drafts
            WHERE ranked_drafts.draft_rank = 1
         )
         SELECT tg.id, tg.communication_number, tg.queue_sequence, tg.status,
                active_recall.id AS recall_id,
                active_recall.sequence AS recall_sequence,
                active_recall.started_at AS recall_started_at,
                active_recall.expires_at AS recall_expires_at,
                COALESCE((
                  SELECT MAX(recall_count.sequence)
                    FROM ticket_group_recalls recall_count
                   WHERE recall_count.ticket_group_id = tg.id
                ), 0) AS recall_count,
                p.id AS product_id, p.code AS product_code,
                p.name AS product_name, p.resource_group_id, p.gate_id,
                g.label AS gate_label,
                COUNT(t.id) AS ticket_count,
                SUM(CASE WHEN t.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS present_count,
                next_segment.ticket_count AS next_segment_ticket_count,
                next_segment.present_count AS next_segment_present_count,
                next_segment.segment_index,
                next_segment.segment_count,
                next_segment.precalled_at
           FROM ticket_groups tg
           JOIN products p ON p.id = tg.product_id
           JOIN gates g ON g.id = p.gate_id
           JOIN tickets t ON t.ticket_group_id = tg.id
           JOIN next_draft_segments next_segment ON next_segment.ticket_group_id = tg.id
           LEFT JOIN ticket_group_recalls active_recall
             ON active_recall.ticket_group_id = tg.id
            AND active_recall.ended_at IS NULL
            AND active_recall.expires_at > ?2
          WHERE tg.operation_day_id = ?1 AND tg.status IN ('QUEUED', 'PRESENT', 'MISSING')
          GROUP BY tg.id, p.id, next_segment.ticket_count, next_segment.present_count,
                   next_segment.segment_index, next_segment.segment_count,
                   next_segment.precalled_at,
                   active_recall.id, active_recall.sequence, active_recall.started_at,
                   active_recall.expires_at
          ORDER BY tg.queue_sequence`,
      )
        .bind(eventId, projectionReadAt)
        .all<{
          id: string;
          communication_number: number;
          queue_sequence: number;
          status: string;
          recall_count: number;
          recall_id: string | null;
          recall_sequence: number | null;
          recall_started_at: string | null;
          recall_expires_at: string | null;
          product_id: string;
          product_code: string;
          product_name: string;
          resource_group_id: string;
          gate_id: string;
          gate_label: string;
          ticket_count: number;
          present_count: number;
          next_segment_ticket_count: number;
          next_segment_present_count: number;
          segment_index: number;
          segment_count: number;
          precalled_at: string | null;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT reserved_group.value AS ticket_group_id, lease.operator_account_id, lease.device_id
           FROM dispatch_recommendation_leases lease
           JOIN json_each(lease.ticket_group_ids_json) reserved_group
          WHERE lease.operation_day_id = ?1 AND lease.status = 'ACTIVE'
            AND lease.expires_at > ?2
          ORDER BY lease.acquired_at, lease.id`,
      )
        .bind(eventId, projectionReadAt)
        .all<{
          ticket_group_id: string;
          operator_account_id: string;
          device_id: string;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT (julianday(landed_at) - julianday(departed_at)) * 1440.0 AS duration_minutes
         FROM rotations
        WHERE operation_day_id = ?1 AND departed_at IS NOT NULL AND landed_at IS NOT NULL
        ORDER BY landed_at DESC LIMIT 12`,
      )
        .bind(eventId)
        .all<{ duration_minutes: number }>(),
    () =>
      context.env.DB.prepare(
        `SELECT m.resource_group_id, a.passenger_seats, a.refuel_planned,
                a.operational_state, a.operational_interrupted
           FROM aircraft a
         JOIN resource_group_memberships m ON m.aircraft_id = a.id
        WHERE m.operation_day_id = ?1 AND m.active_until IS NULL`,
      )
        .bind(eventId)
        .all<{
          resource_group_id: string;
          passenger_seats: number;
          refuel_planned: number;
          operational_state: string;
          operational_interrupted: number;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT a.id, a.version, a.registration, a.aircraft_type, a.passenger_seats,
              a.maximum_passenger_payload_kg, a.operational_state,
              COALESCE(a.operational_state_changed_at, a.updated_at) AS operational_state_changed_at,
              a.refuel_planned, a.rotations_since_refuel, a.refuel_reminder_threshold,
              a.operational_interrupted,
              m.resource_group_id, rg.name AS resource_group_name,
              rg.short_code AS resource_group_short_code,
              m.current_pilot_id, current_pilot.operational_code AS current_pilot_operational_code,
              (SELECT b.expected_review_at FROM operational_blocks b
                WHERE b.operation_day_id = m.operation_day_id AND b.scope_type = 'AIRCRAFT'
                  AND b.scope_id = a.id AND b.status = 'ACTIVE'
                ORDER BY b.started_at DESC LIMIT 1) AS expected_review_at
         FROM aircraft a
         LEFT JOIN resource_group_memberships m ON m.aircraft_id = a.id
          AND m.operation_day_id = ?1 AND m.active_until IS NULL
         LEFT JOIN resource_groups rg ON rg.id = m.resource_group_id
         LEFT JOIN pilots current_pilot ON current_pilot.id = m.current_pilot_id
        ORDER BY a.registration`,
      )
        .bind(eventId)
        .all<{
          id: string;
          version: number;
          registration: string;
          aircraft_type: string;
          passenger_seats: number;
          maximum_passenger_payload_kg: number | null;
          operational_state: string;
          operational_state_changed_at: string;
          refuel_planned: number;
          rotations_since_refuel: number;
          refuel_reminder_threshold: number;
          operational_interrupted: number;
          resource_group_id: string | null;
          resource_group_name: string | null;
          resource_group_short_code: string | null;
          current_pilot_id: string | null;
          current_pilot_operational_code: string | null;
          expected_review_at: string | null;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT p.id, p.operational_code, p.operational_note, p.active, p.paused,
              p.pause_expected_review_at,
              (SELECT r.id FROM rotations r WHERE r.operation_day_id = p.operation_day_id
                AND r.pilot_id = p.id AND r.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                ORDER BY r.updated_at DESC LIMIT 1) AS current_rotation_id,
              (SELECT fg.communication_number FROM rotations r
                JOIN flight_groups fg ON fg.id = r.flight_group_id
                WHERE r.operation_day_id = p.operation_day_id AND r.pilot_id = p.id
                  AND r.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                ORDER BY r.updated_at DESC LIMIT 1) AS current_communication_number
         FROM pilots p WHERE p.operation_day_id = ?1 ORDER BY p.operational_code`,
      )
        .bind(eventId)
        .all<{
          id: string;
          operational_code: string;
          operational_note: string;
          active: number;
          paused: number;
          pause_expected_review_at: string | null;
          current_rotation_id: string | null;
          current_communication_number: number | null;
        }>(),
    () =>
      withGateDisplayFilterFallback((mode) => {
        const displayFilterProjection =
          mode === "current"
            ? "g.display_filter_json"
            : `'${EMPTY_GATE_DISPLAY_FILTER_JSON}' AS display_filter_json`;
        return context.env.DB.prepare(
          `SELECT g.id, g.label, g.gate_type, g.active, g.sort_order,
                g.travel_lead_minutes, ${displayFilterProjection},
                COALESCE((SELECT json_group_array(rg.id) FROM resource_groups rg
                  WHERE rg.operation_day_id = g.operation_day_id AND rg.gate_id = g.id), '[]')
                  AS assigned_resource_group_ids_json
             FROM gates g WHERE g.operation_day_id = ?1 ORDER BY g.sort_order, g.label`,
        )
          .bind(eventId)
          .all<{
            id: string;
            label: string;
            gate_type: "FLIGHT_LINE" | "BOARDING" | "DISPLAY_ONLY";
            active: number;
            sort_order: number;
            travel_lead_minutes: number;
            display_filter_json: string;
            assigned_resource_group_ids_json: string;
          }>();
      }),
    () =>
      context.env.DB.prepare(
        `SELECT rg.id, rg.version, rg.name, rg.short_code, rg.status, rg.operational_note,
              rg.gate_id, g.label AS gate_label,
              rg.reference_capacity,
              rg.compatible_aircraft_types_json, rg.automatic_precall_enabled,
              COALESCE((SELECT json_group_array(m.aircraft_id)
                FROM resource_group_memberships m
               WHERE m.operation_day_id = rg.operation_day_id
                 AND m.resource_group_id = rg.id AND m.active_until IS NULL), '[]') AS aircraft_ids_json
         FROM resource_groups rg JOIN gates g ON g.id = rg.gate_id
        WHERE rg.operation_day_id = ?1 ORDER BY rg.name`,
      )
        .bind(eventId)
        .all<{
          id: string;
          version: number;
          name: string;
          short_code: string;
          status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
          operational_note: string;
          gate_id: string;
          gate_label: string;
          reference_capacity: number;
          compatible_aircraft_types_json: string;
          automatic_precall_enabled: number;
          aircraft_ids_json: string;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT plan.id, plan.version, plan.scope_type, plan.scope_id,
                plan.constraint_kind, plan.effect_mode, plan.duration_multiplier_percent,
                plan.start_mode, plan.earliest_start_at,
                plan.latest_start_at, plan.after_rotation_id,
                plan.minimum_duration_minutes, plan.typical_duration_minutes,
                plan.maximum_duration_minutes, plan.status, plan.public_note,
                plan.created_at, plan.updated_at, plan.activated_at, plan.cleared_at,
                plan.canceled_at, plan.recurring_rule_id, plan.recurrence_sequence,
                after_rotation.status AS after_rotation_status
           FROM planned_operational_constraints plan
           LEFT JOIN rotations after_rotation ON after_rotation.id = plan.after_rotation_id
          WHERE plan.operation_day_id = ?1
          ORDER BY
            CASE plan.status WHEN 'ACTIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
            COALESCE(plan.earliest_start_at, plan.created_at), plan.created_at`,
      )
        .bind(eventId)
        .all<{
          id: string;
          version: number;
          scope_type: "EVENT" | "RESOURCE_GROUP" | "AIRCRAFT" | "PILOT";
          scope_id: string;
          constraint_kind:
            | "PAUSE"
            | "REFUELING"
            | "FLIGHT_SHOW"
            | "WEATHER"
            | "TECHNICAL"
            | "OTHER";
          effect_mode: "BLOCKING" | "SLOWDOWN";
          duration_multiplier_percent: number | null;
          start_mode: "TIME_WINDOW" | "AFTER_CURRENT_ROTATION";
          earliest_start_at: string | null;
          latest_start_at: string | null;
          after_rotation_id: string | null;
          minimum_duration_minutes: number;
          typical_duration_minutes: number;
          maximum_duration_minutes: number;
          status: "PLANNED" | "ACTIVE" | "CLEARED" | "CANCELED";
          public_note: string;
          created_at: string;
          updated_at: string;
          activated_at: string | null;
          cleared_at: string | null;
          canceled_at: string | null;
          recurring_rule_id: string | null;
          recurrence_sequence: number | null;
          after_rotation_status: string | null;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT rule.id, rule.operation_day_id, rule.version, rule.scope_type, rule.scope_id,
                rule.operation_kind, rule.trigger_metric, rule.interval_value,
                rule.progress_value, rule.minimum_duration_minutes,
                rule.typical_duration_minutes, rule.maximum_duration_minutes,
                rule.status, rule.sequence_number, rule.reason, rule.last_reset_at,
                rule.created_at, rule.updated_at,
                (SELECT plan.id FROM planned_operational_constraints plan
                  WHERE plan.recurring_rule_id = rule.id
                    AND plan.status IN ('PLANNED', 'ACTIVE')
                  ORDER BY plan.recurrence_sequence DESC LIMIT 1) AS open_plan_id
           FROM recurring_operational_rules rule
          WHERE rule.operation_day_id = ?1
          ORDER BY CASE rule.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
                   rule.scope_type, rule.scope_id, rule.operation_kind`,
      )
        .bind(eventId)
        .all<{
          id: string;
          operation_day_id: string;
          version: number;
          scope_type: "AIRCRAFT" | "PILOT";
          scope_id: string;
          operation_kind: "PAUSE" | "REFUELING";
          trigger_metric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
          interval_value: number;
          progress_value: number;
          minimum_duration_minutes: number;
          typical_duration_minutes: number;
          maximum_duration_minutes: number;
          status: "ACTIVE" | "DISABLED";
          sequence_number: number;
          reason: string;
          last_reset_at: string;
          created_at: string;
          updated_at: string;
          open_plan_id: string | null;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1
              AND t.status NOT IN ('COMPLETED', 'CANCELED', 'NO_SHOW')) AS open_tickets,
          (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1) AS sold_tickets,
          (SELECT COUNT(*) FROM rotations WHERE operation_day_id = ?1 AND status = 'COMPLETED') AS completed_rotations,
          (SELECT COUNT(*) FROM rotations WHERE operation_day_id = ?1
            AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')) AS active_rotations,
          (SELECT ROUND(AVG((julianday(departed_at) - julianday(called_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND called_at IS NOT NULL AND departed_at IS NOT NULL)
            AS average_boarding_minutes,
          (SELECT ROUND(AVG((julianday(landed_at) - julianday(departed_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND departed_at IS NOT NULL AND landed_at IS NOT NULL)
            AS average_flight_minutes,
          (SELECT ROUND(AVG((julianday(completed_at) - julianday(landed_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND landed_at IS NOT NULL AND completed_at IS NOT NULL)
            AS average_turnaround_minutes,
          (SELECT ROUND(AVG((julianday(completed_at) - julianday(called_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND called_at IS NOT NULL AND completed_at IS NOT NULL)
            AS average_rotation_minutes,
          (SELECT ROUND(AVG((julianday(r.called_at) - julianday(tg.sold_at)) * 1440.0), 1)
            FROM ticket_groups tg
            JOIN tickets t ON t.ticket_group_id = tg.id
            JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
            JOIN rotations r ON r.id = rt.rotation_id
            WHERE tg.operation_day_id = ?1 AND r.called_at IS NOT NULL) AS average_wait_minutes,
          (SELECT COALESCE(SUM(CASE WHEN t.status <> 'CANCELED' THEN t.price_cents ELSE 0 END), 0)
            FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1) AS informational_revenue_cents,
          (SELECT COUNT(*) FROM paired_devices WHERE operation_day_id = ?1 AND active = 1
            AND last_seen_at >= ?2) AS active_devices,
          (SELECT COUNT(*) FROM web_push_subscriptions WHERE operation_day_id = ?1
            AND status = 'ACTIVE' AND delete_after > ?3) AS active_push_subscriptions`,
      )
        .bind(eventId, new Date(Date.now() - 120_000).toISOString(), new Date().toISOString())
        .first<{
          open_tickets: number;
          sold_tickets: number;
          completed_rotations: number;
          active_rotations: number;
          average_boarding_minutes: number | null;
          average_flight_minutes: number | null;
          average_turnaround_minutes: number | null;
          average_rotation_minutes: number | null;
          average_wait_minutes: number | null;
          informational_revenue_cents: number;
          active_devices: number;
          active_push_subscriptions: number;
        }>(),
  ] as const);

  let assistClaims: Array<{
    aircraft_id: string;
    operator_account_id: string;
    login_code: string;
    claimed_at: string;
    expires_at: string;
    revision: number;
  }> = [];
  try {
    const claims = await context.env.DB.prepare(
      `SELECT claim.aircraft_id, claim.operator_account_id, account.login_code,
              claim.claimed_at, claim.expires_at, claim.revision
         FROM flight_line_assist_claims claim
         JOIN operator_accounts account ON account.id = claim.operator_account_id
        WHERE claim.operation_day_id = ?1 AND claim.expires_at > ?2
        ORDER BY claim.claimed_at`,
    )
      .bind(eventId, new Date().toISOString())
      .all<{
        aircraft_id: string;
        operator_account_id: string;
        login_code: string;
        claimed_at: string;
        expires_at: string;
        revision: number;
      }>();
    assistClaims = claims.results;
  } catch (cause) {
    if (!String(cause).includes("no such table: flight_line_assist_claims")) throw cause;
  }

  const actualDurations = [...durationRows.results].reverse().map((row) => row.duration_minutes);
  const activePilotCount = pilotRows.results.filter(
    (pilot) => pilot.active === 1 && pilot.paused === 0,
  ).length;
  const forecastReadAt = new Date().toISOString();
  const forecastReferenceMs = Date.parse(forecastReadAt);
  const operationsEnd = eventRow.operations_end_at ? Date.parse(eventRow.operations_end_at) : 0;
  const operationsEndMinutes = Math.max(0, (operationsEnd - forecastReferenceMs) / 60_000);
  const dispatchReservationByGroupId = new Map<string, "OWN" | "OTHER">();
  for (const lease of dispatchLeaseRows.results) {
    const reservation =
      device.accountId !== null &&
      lease.operator_account_id === device.accountId &&
      lease.device_id === device.id
        ? "OWN"
        : "OTHER";
    if (reservation === "OWN" || !dispatchReservationByGroupId.has(lease.ticket_group_id)) {
      dispatchReservationByGroupId.set(lease.ticket_group_id, reservation);
    }
  }

  const response = context.json({
    currentDeviceRole: device.role,
    event: rowToSnapshot(eventRow),
    products: products.results.map((product) => {
      const effectiveTurnaroundProfile = resolveTurnaroundProfile({
        event: {
          sourceId: eventId,
          boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
          deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
          bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
        },
        product: {
          sourceId: product.id,
          boardingMinutes: product.planned_boarding_minutes_override,
          deboardingMinutes: product.planned_deboarding_minutes_override,
          bufferMinutes: product.planned_buffer_minutes_override,
        },
      });
      const assignedGroupAircraft = aircraftRows.results.filter(
        (aircraft) => aircraft.resource_group_id === product.resource_group_id,
      );
      const operationalGroupAircraft = assignedGroupAircraft.filter(
        (aircraft) =>
          !["INACTIVE", "PAUSED", "REFUELING"].includes(aircraft.operational_state) &&
          aircraft.operational_interrupted === 0,
      );
      const allGroupAircraftSeats = assignedGroupAircraft.map(
        (aircraft) => aircraft.passenger_seats,
      );
      const groupAircraftSeats = operationalGroupAircraft
        .map((aircraft) => aircraft.passenger_seats)
        .slice(0, activePilotCount);
      const effectiveReferenceCapacity = Math.max(
        1,
        deriveResourceGroupCapacity(allGroupAircraftSeats),
      );
      const activeAircraft = groupAircraftSeats.length;
      const queueSequence = Math.max(
        1,
        Math.ceil(product.queued_tickets / product.reference_capacity),
      );
      const duration = estimateDuration({
        referenceMinutes:
          product.reference_duration_minutes + effectiveTurnaroundProfile.totalGroundMinutes,
        actualDurationsMinutes: actualDurations,
        interrupted:
          product.resource_group_status !== "ACTIVE" ||
          eventRow.emergency_mode === 1 ||
          eventRow.operational_interrupted === 1,
        activeCapacity: activeAircraft,
      });
      const fallbackForecast = forecastQueueWindows({ queueSequence, activeAircraft, duration });
      const firstQueuedRotation = rotations.results.find(
        (rotation) =>
          rotation.resource_group_id === product.resource_group_id &&
          rotation.status === "DRAFT" &&
          rotation.prediction_lower_minutes !== null &&
          rotation.prediction_upper_minutes !== null,
      );
      const preOperationsOffset = eventRow.operations_start_at
        ? Math.max(0, (Date.parse(eventRow.operations_start_at) - forecastReferenceMs) / 60_000)
        : 0;
      const forecast = firstQueuedRotation
        ? {
            lowerMinutes: firstQueuedRotation.prediction_lower_minutes ?? 0,
            upperMinutes: firstQueuedRotation.prediction_upper_minutes ?? 0,
            quality: firstQueuedRotation.prediction_quality ?? fallbackForecast.quality,
          }
        : preOperationsOffset > 0
          ? {
              lowerMinutes: Math.max(0, Math.round(preOperationsOffset - 5)),
              upperMinutes: Math.round(preOperationsOffset + 5),
              quality: "CHANGING" as const,
            }
          : fallbackForecast;
      const forecastMidpointMinutes = (forecast.lowerMinutes + forecast.upperMinutes) / 2;
      const storedForecastCenterMs = firstQueuedRotation?.predicted_boarding_at
        ? Date.parse(firstQueuedRotation.predicted_boarding_at)
        : Number.NaN;
      const nextBoardingWindowLowerAt =
        forecast.quality === "UNCERTAIN"
          ? null
          : new Date(
              Number.isFinite(storedForecastCenterMs)
                ? storedForecastCenterMs +
                    (forecast.lowerMinutes - forecastMidpointMinutes) * 60_000
                : forecastReferenceMs + forecast.lowerMinutes * 60_000,
            ).toISOString();
      const nextBoardingWindowUpperAt =
        forecast.quality === "UNCERTAIN"
          ? null
          : new Date(
              Date.parse(nextBoardingWindowLowerAt ?? new Date(forecastReferenceMs).toISOString()) +
                Math.max(0, forecast.upperMinutes - forecast.lowerMinutes) * 60_000,
            ).toISOString();
      const resourceGroupRotations = rotations.results.filter(
        (rotation) => rotation.resource_group_id === product.resource_group_id,
      );
      const blockingUnprojectedQueue = resourceGroupRotations.some(
        (rotation) =>
          rotation.status === "DRAFT" &&
          rotation.ticket_count > 0 &&
          rotation.predicted_completion_at === null &&
          !["ATTENDANCE_MISSING", "ATTENDANCE_CLARIFICATION"].includes(
            rotation.dispatch_unplanned_reason ?? "",
          ),
      );
      const availablePilots = pilotRows.results
        .flatMap((pilot) => {
          if (pilot.active !== 1) return [];
          const activeRotation = pilot.current_rotation_id
            ? resourceGroupRotations.find((rotation) => rotation.id === pilot.current_rotation_id)
            : undefined;
          const availableAt = activeRotation?.predicted_completion_at
            ? Date.parse(activeRotation.predicted_completion_at)
            : pilot.paused === 1
              ? pilot.pause_expected_review_at
                ? Date.parse(pilot.pause_expected_review_at)
                : Number.NaN
              : forecastReferenceMs;
          if (!Number.isFinite(availableAt)) return [];
          return [
            {
              id: pilot.id,
              availableMinutes: Math.max(0, (availableAt - forecastReferenceMs) / 60_000),
            },
          ];
        })
        .sort(
          (left, right) =>
            left.availableMinutes - right.availableMinutes || left.id.localeCompare(right.id),
        );
      const compatibleAircraftTypes = new Set(
        JSON.parse(
          resourceGroupRows.results.find((group) => group.id === product.resource_group_id)
            ?.compatible_aircraft_types_json ?? "[]",
        ) as string[],
      );
      const capacityLanes =
        eventRow.operational_interrupted === 1 ||
        product.resource_group_status !== "ACTIVE" ||
        blockingUnprojectedQueue
          ? []
          : fleetRows.results
              .filter(
                (aircraft) =>
                  aircraft.resource_group_id === product.resource_group_id &&
                  aircraft.operational_state !== "INACTIVE" &&
                  (compatibleAircraftTypes.size === 0 ||
                    compatibleAircraftTypes.has(aircraft.aircraft_type)),
              )
              .flatMap((aircraft) => {
                const assignedRotations = resourceGroupRotations.filter(
                  (rotation) =>
                    rotation.aircraft_id === aircraft.id ||
                    rotation.forecast_assumed_aircraft_id === aircraft.id,
                );
                const unknownReturn =
                  (aircraft.operational_interrupted === 1 ||
                    ["PAUSED", "REFUELING"].includes(aircraft.operational_state)) &&
                  aircraft.expected_review_at === null &&
                  !assignedRotations.some((rotation) => rotation.predicted_completion_at !== null);
                if (unknownReturn) return [];
                const projectedCompletions = assignedRotations.flatMap((rotation) => {
                  if (!rotation.predicted_completion_at) return [];
                  const expectedMinutes = Math.max(
                    0,
                    (Date.parse(rotation.predicted_completion_at) - forecastReferenceMs) / 60_000,
                  );
                  const intervalWidth = Math.max(
                    0,
                    (rotation.prediction_upper_minutes ?? 0) -
                      (rotation.prediction_lower_minutes ?? 0),
                  );
                  return [
                    {
                      lowerMinutes: Math.max(0, expectedMinutes - intervalWidth / 2),
                      expectedMinutes,
                      upperMinutes: expectedMinutes + intervalWidth / 2,
                    },
                  ];
                });
                const returnMinutes = aircraft.expected_review_at
                  ? Math.max(
                      0,
                      (Date.parse(aircraft.expected_review_at) - forecastReferenceMs) / 60_000,
                    )
                  : 0;
                return [
                  {
                    aircraft,
                    lowerMinutes: Math.max(
                      returnMinutes,
                      ...projectedCompletions.map((entry) => entry.lowerMinutes),
                    ),
                    expectedMinutes: Math.max(
                      returnMinutes,
                      ...projectedCompletions.map((entry) => entry.expectedMinutes),
                    ),
                    upperMinutes: Math.max(
                      returnMinutes,
                      ...projectedCompletions.map((entry) => entry.upperMinutes),
                    ),
                  },
                ];
              })
              .sort(
                (left, right) =>
                  left.expectedMinutes - right.expectedMinutes ||
                  left.aircraft.id.localeCompare(right.aircraft.id),
              )
              .slice(0, availablePilots.length)
              .flatMap((lane, index) => {
                const pilot = availablePilots[index];
                if (!pilot) return [];
                const applicablePlans = plannedOperationRows.results.filter(
                  (plan) =>
                    plan.status !== "CLEARED" &&
                    plan.status !== "CANCELED" &&
                    (plan.scope_type === "EVENT" ||
                      (plan.scope_type === "RESOURCE_GROUP" &&
                        plan.scope_id === product.resource_group_id) ||
                      (plan.scope_type === "AIRCRAFT" && plan.scope_id === lane.aircraft.id) ||
                      (plan.scope_type === "PILOT" && plan.scope_id === pilot.id)),
                );
                const unknownConstraintStart = applicablePlans.some(
                  (plan) =>
                    plan.start_mode === "AFTER_CURRENT_ROTATION" &&
                    !resourceGroupRotations.find(
                      (rotation) => rotation.id === plan.after_rotation_id,
                    )?.predicted_completion_at,
                );
                if (unknownConstraintStart) return [];
                const constraints = applicablePlans.map((plan) => {
                  const afterRotationCompletion = resourceGroupRotations.find(
                    (rotation) => rotation.id === plan.after_rotation_id,
                  )?.predicted_completion_at;
                  const earliestStart =
                    plan.start_mode === "AFTER_CURRENT_ROTATION"
                      ? Date.parse(afterRotationCompletion ?? forecastReadAt)
                      : Date.parse(plan.earliest_start_at ?? forecastReadAt);
                  const latestStart =
                    plan.start_mode === "AFTER_CURRENT_ROTATION"
                      ? earliestStart
                      : Date.parse(
                          plan.latest_start_at ?? plan.earliest_start_at ?? forecastReadAt,
                        );
                  const earliestStartMinutes = Math.max(
                    0,
                    (earliestStart - forecastReferenceMs) / 60_000,
                  );
                  const latestStartMinutes = Math.max(
                    earliestStartMinutes,
                    (latestStart - forecastReferenceMs) / 60_000,
                  );
                  return {
                    id: plan.id,
                    earliestStartMinutes,
                    expectedStartMinutes: (earliestStartMinutes + latestStartMinutes) / 2,
                    latestStartMinutes,
                    minimumDurationMinutes: plan.minimum_duration_minutes,
                    typicalDurationMinutes: plan.typical_duration_minutes,
                    maximumDurationMinutes: plan.maximum_duration_minutes,
                    effectMode: plan.effect_mode,
                    durationMultiplierPercent: plan.duration_multiplier_percent,
                    active: plan.status === "ACTIVE",
                  };
                });
                const recurringConstraints = recurringRuleRows.results
                  .filter(
                    (rule) =>
                      rule.status === "ACTIVE" &&
                      ((rule.scope_type === "AIRCRAFT" && rule.scope_id === lane.aircraft.id) ||
                        (rule.scope_type === "PILOT" && rule.scope_id === pilot.id)),
                  )
                  .map((rule) => ({
                    id: rule.id,
                    triggerMetric: rule.trigger_metric,
                    intervalValue: rule.interval_value,
                    lowerProgress: rule.progress_value,
                    expectedProgress: rule.progress_value,
                    upperProgress: rule.progress_value,
                    minimumDurationMinutes: rule.minimum_duration_minutes,
                    typicalDurationMinutes: rule.typical_duration_minutes,
                    maximumDurationMinutes: rule.maximum_duration_minutes,
                    active: true,
                  }));
                return [
                  {
                    laneId: `${lane.aircraft.id}:${pilot.id}`,
                    aircraftId: lane.aircraft.id,
                    passengerSeats: lane.aircraft.passenger_seats,
                    lowerMinutes: Math.max(lane.lowerMinutes, pilot.availableMinutes),
                    expectedMinutes: Math.max(lane.expectedMinutes, pilot.availableMinutes),
                    upperMinutes: Math.max(lane.upperMinutes, pilot.availableMinutes),
                    constraints,
                    recurringConstraints,
                  },
                ];
              });
      const availabilityAfterQueue = createQueueAvailability({
        activeAircraft: 0,
        busyAircraftMinutes: [],
        lanes: capacityLanes,
      });
      const durationByAircraftId = new Map(
        capacityLanes.map((lane) => {
          const override = aircraftProductTurnaroundOverrideRows.results.find(
            (entry) => entry.aircraft_id === lane.aircraftId && entry.product_id === product.id,
          );
          const aircraftProfile = resolveTurnaroundProfile({
            event: {
              sourceId: eventId,
              boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
              deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
              bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
            },
            product: {
              sourceId: product.id,
              boardingMinutes: product.planned_boarding_minutes_override,
              deboardingMinutes: product.planned_deboarding_minutes_override,
              bufferMinutes: product.planned_buffer_minutes_override,
            },
            ...(override
              ? {
                  aircraftProduct: {
                    sourceId: `${override.aircraft_id}:${override.product_id}`,
                    boardingMinutes: override.planned_boarding_minutes_override,
                    deboardingMinutes: override.planned_deboarding_minutes_override,
                    bufferMinutes: override.planned_buffer_minutes_override,
                  },
                }
              : {}),
          });
          return [
            lane.aircraftId,
            estimateDuration({
              referenceMinutes:
                product.reference_duration_minutes + aircraftProfile.totalGroundMinutes,
              actualDurationsMinutes: actualDurations,
              interrupted: false,
              activeCapacity: Math.max(1, capacityLanes.length),
            }),
          ] as const;
        }),
      );
      const queuedSeatsCompletedByEnd = resourceGroupRotations
        .filter(
          (rotation) =>
            rotation.status === "DRAFT" &&
            rotation.predicted_completion_at !== null &&
            Date.parse(rotation.predicted_completion_at) <= operationsEnd,
        )
        .reduce((sum, rotation) => sum + rotation.ticket_count, 0);
      const capacity = assessMarginalProductCapacity({
        operationsEndMinutes,
        availabilityAfterQueue,
        duration,
        durationByAircraftId,
        queuedSeatsCompletedByEnd,
        openTickets: product.resource_group_open_tickets,
        predictionQuality: forecast.quality,
        warningThreshold: product.capacity_warning_threshold,
        criticalThreshold: product.capacity_critical_threshold,
      });
      return {
        id: product.id,
        code: product.code,
        name: product.name,
        publicDescription: product.public_description,
        resourceGroupId: product.resource_group_id,
        resourceGroupName: product.resource_group_name,
        resourceGroupStatus: product.resource_group_status,
        resourceGroupOperationalNote: product.resource_group_operational_note,
        priceCents: product.price_cents,
        gateId: product.gate_id,
        gateLabel: product.gate_label,
        childCompanionRequired: product.child_companion_required === 1,
        weightClasses: JSON.parse(product.weight_classes_json) as Array<
          "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
        >,
        sortOrder: product.sort_order,
        saleEnabled: product.sale_enabled === 1,
        referenceCapacity: effectiveReferenceCapacity,
        referenceDurationMinutes: product.reference_duration_minutes,
        promisedFlightMinutes: product.promised_flight_minutes,
        plannedBoardingMinutesOverride: product.planned_boarding_minutes_override,
        plannedDeboardingMinutesOverride: product.planned_deboarding_minutes_override,
        plannedBufferMinutesOverride: product.planned_buffer_minutes_override,
        effectiveTurnaroundProfile,
        queuedTickets: product.queued_tickets,
        resourceGroupOpenTickets: product.resource_group_open_tickets,
        estimatedWaitLowerMinutes: forecast.lowerMinutes,
        estimatedWaitUpperMinutes: forecast.upperMinutes,
        nextBoardingWindowLowerAt,
        nextBoardingWindowUpperAt,
        remainingSellableSeats: capacity.remainingSellableSeats,
        projectedSeats: capacity.projectedSeats,
        capacityStatus: capacity.status,
        saleRecommended:
          capacity.saleRecommended &&
          eventRow.status === "ACTIVE" &&
          product.sale_enabled === 1 &&
          product.resource_group_status === "ACTIVE" &&
          eventRow.emergency_mode === 0 &&
          eventRow.operational_interrupted !== 1 &&
          (product.sale_closes_at === null || Date.parse(product.sale_closes_at) > Date.now()) &&
          (!eventRow.sale_opens_at || Date.parse(eventRow.sale_opens_at) <= Date.now()),
        saleClosesAt: product.sale_closes_at,
        capacityWarningThreshold: product.capacity_warning_threshold,
        capacityCriticalThreshold: product.capacity_critical_threshold,
        predictionQuality: forecast.quality,
      };
    }),
    aircraftProductTurnaroundOverrides: aircraftProductTurnaroundOverrideRows.results.flatMap(
      (override) => {
        const product = products.results.find((candidate) => candidate.id === override.product_id);
        if (!product) return [];
        return [
          {
            aircraftId: override.aircraft_id,
            productId: override.product_id,
            version: override.version,
            plannedBoardingMinutesOverride: override.planned_boarding_minutes_override,
            plannedDeboardingMinutesOverride: override.planned_deboarding_minutes_override,
            plannedBufferMinutesOverride: override.planned_buffer_minutes_override,
            effectiveTurnaroundProfile: resolveTurnaroundProfile({
              event: {
                sourceId: eventId,
                boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
                deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
                bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
              },
              product: {
                sourceId: product.id,
                boardingMinutes: product.planned_boarding_minutes_override,
                deboardingMinutes: product.planned_deboarding_minutes_override,
                bufferMinutes: product.planned_buffer_minutes_override,
              },
              aircraftProduct: {
                sourceId: `${override.aircraft_id}:${override.product_id}`,
                boardingMinutes: override.planned_boarding_minutes_override,
                deboardingMinutes: override.planned_deboarding_minutes_override,
                bufferMinutes: override.planned_buffer_minutes_override,
              },
            }),
          },
        ];
      },
    ),
    rotations: rotations.results.map((rotation, index) => {
      const activeAircraft = aircraftRows.results.filter(
        (aircraft) =>
          aircraft.resource_group_id === rotation.resource_group_id &&
          !["INACTIVE", "PAUSED", "REFUELING"].includes(aircraft.operational_state) &&
          aircraft.operational_interrupted === 0,
      ).length;
      const effectiveActiveCapacity = Math.min(activeAircraft, activePilotCount);
      const suggestedAircraft = fleetRows.results.find(
        (aircraft) => aircraft.id === rotation.suggested_aircraft_id,
      );
      const dispatchPlanFresh = rotation.dispatch_operation_day_version === eventRow.version;
      const dispatchAircraft = dispatchPlanFresh
        ? fleetRows.results.find(
            (aircraft) => aircraft.id === rotation.forecast_assumed_aircraft_id,
          )
        : undefined;
      const dispatchPilotId = rotation.dispatch_lane_id?.split(":")[1] ?? null;
      const dispatchPilot = dispatchPlanFresh
        ? pilotRows.results.find(
            (pilot) => pilot.id === dispatchPilotId && pilot.active === 1 && pilot.paused === 0,
          )
        : undefined;
      const rememberedPilot = pilotRows.results.find(
        (pilot) =>
          pilot.id === suggestedAircraft?.current_pilot_id &&
          pilot.active === 1 &&
          pilot.paused === 0 &&
          pilot.current_rotation_id === null,
      );
      const rotationProduct = products.results.find(
        (product) => product.code === rotation.product_code,
      );
      const profileAircraftId =
        rotation.aircraft_id ??
        (dispatchPlanFresh ? rotation.forecast_assumed_aircraft_id : null) ??
        null;
      const aircraftProductOverride = profileAircraftId
        ? aircraftProductTurnaroundOverrideRows.results.find(
            (override) =>
              override.product_id === rotationProduct?.id &&
              override.aircraft_id === profileAircraftId,
          )
        : undefined;
      const resolvedTurnaroundProfile = resolveTurnaroundProfile({
        event: {
          sourceId: eventId,
          boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
          deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
          bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
        },
        ...(rotationProduct
          ? {
              product: {
                sourceId: rotationProduct.id,
                boardingMinutes: rotationProduct.planned_boarding_minutes_override,
                deboardingMinutes: rotationProduct.planned_deboarding_minutes_override,
                bufferMinutes: rotationProduct.planned_buffer_minutes_override,
              },
            }
          : {}),
        ...(aircraftProductOverride && rotationProduct
          ? {
              aircraftProduct: {
                sourceId: `${aircraftProductOverride.aircraft_id}:${rotationProduct.id}`,
                boardingMinutes: aircraftProductOverride.planned_boarding_minutes_override,
                deboardingMinutes: aircraftProductOverride.planned_deboarding_minutes_override,
                bufferMinutes: aircraftProductOverride.planned_buffer_minutes_override,
              },
            }
          : {}),
      });
      const frozenSource = (
        source: string | null,
        fallback: (typeof resolvedTurnaroundProfile)["boarding"],
      ) => {
        const separator = source?.indexOf(":") ?? -1;
        const sourceLevel = source?.slice(0, separator);
        return separator > 0 && ["AIRCRAFT_PRODUCT", "PRODUCT", "EVENT"].includes(sourceLevel ?? "")
          ? {
              sourceLevel: sourceLevel as "AIRCRAFT_PRODUCT" | "PRODUCT" | "EVENT",
              sourceId: source?.slice(separator + 1) ?? fallback.sourceId,
            }
          : { sourceLevel: fallback.sourceLevel, sourceId: fallback.sourceId };
      };
      const effectiveTurnaroundProfile =
        rotation.turnaround_boarding_minutes !== null &&
        rotation.turnaround_deboarding_minutes !== null &&
        rotation.turnaround_buffer_minutes !== null
          ? {
              boarding: {
                valueMinutes: rotation.turnaround_boarding_minutes,
                ...frozenSource(
                  rotation.turnaround_boarding_source,
                  resolvedTurnaroundProfile.boarding,
                ),
              },
              deboarding: {
                valueMinutes: rotation.turnaround_deboarding_minutes,
                ...frozenSource(
                  rotation.turnaround_deboarding_source,
                  resolvedTurnaroundProfile.deboarding,
                ),
              },
              buffer: {
                valueMinutes: rotation.turnaround_buffer_minutes,
                ...frozenSource(
                  rotation.turnaround_buffer_source,
                  resolvedTurnaroundProfile.buffer,
                ),
              },
              totalGroundMinutes:
                rotation.turnaround_boarding_minutes +
                rotation.turnaround_deboarding_minutes +
                rotation.turnaround_buffer_minutes,
            }
          : resolvedTurnaroundProfile;
      const forecastFreshness = assessForecastFreshness({
        predictionQuality: rotation.prediction_quality,
        predictionUpdatedAt: rotation.prediction_updated_at,
        now: forecastReadAt,
      });
      const forecastUnavailable =
        rotation.precall_decision_reason === "NO_FORECAST_CAPACITY" ||
        rotation.precall_decision_reason === "NO_FITTING_AIRCRAFT";
      const effectivePredictionQuality =
        eventRow.emergency_mode === 1 || forecastUnavailable
          ? "UNCERTAIN"
          : forecastFreshness.quality;
      const fallbackWindow = forecastQueueWindows({
        queueSequence: index + 1,
        activeAircraft: effectiveActiveCapacity,
        duration: estimateDuration({
          referenceMinutes:
            rotation.reference_duration_minutes + effectiveTurnaroundProfile.totalGroundMinutes,
          actualDurationsMinutes: actualDurations,
          interrupted: eventRow.emergency_mode === 1 || eventRow.operational_interrupted === 1,
          activeCapacity: effectiveActiveCapacity,
        }),
      });
      const predictedLowerMinutes = forecastUnavailable
        ? null
        : (rotation.prediction_lower_minutes ?? fallbackWindow.lowerMinutes);
      const predictedUpperMinutes = forecastUnavailable
        ? null
        : (rotation.prediction_upper_minutes ?? fallbackWindow.upperMinutes);
      const boardingWindow = predictedBoardingWindow({
        status: rotation.status,
        quality: effectivePredictionQuality,
        predictedBoardingAt: rotation.predicted_boarding_at,
        lowerMinutes: predictedLowerMinutes ?? 0,
        upperMinutes: predictedUpperMinutes ?? 0,
        referenceAt: forecastReadAt,
      });
      const predictedCompletionMs = rotation.predicted_completion_at
        ? Date.parse(rotation.predicted_completion_at)
        : Number.NaN;
      const operationsEndMs = eventRow.operations_end_at
        ? Date.parse(eventRow.operations_end_at)
        : Number.NaN;
      const overtimeMinutes =
        Number.isFinite(predictedCompletionMs) && Number.isFinite(operationsEndMs)
          ? Math.max(0, Math.ceil((predictedCompletionMs - operationsEndMs) / 60_000))
          : 0;
      return {
        id: rotation.id,
        version: rotation.version,
        flightGroupId: rotation.flight_group_id,
        communicationNumber: rotation.communication_number,
        communicationLabel: formatFlightGroupLabel(
          rotation.resource_group_short_code,
          rotation.communication_number,
        ),
        queuePosition: rotation.queue_position,
        productCode: rotation.product_code,
        productName: rotation.product_name,
        status: rotation.status,
        bookingGroups: JSON.parse(rotation.booking_groups_json),
        ticketGroupId: rotation.ticket_group_id,
        gateId: rotation.gate_id,
        gateLabel: rotation.gate_label,
        aircraftId: rotation.aircraft_id,
        aircraftRegistration: rotation.aircraft_registration,
        pilotId: rotation.pilot_id,
        pilotOperationalCode: rotation.pilot_operational_code,
        suggestedPilotId: dispatchPilot?.id ?? rememberedPilot?.id ?? rotation.suggested_pilot_id,
        suggestedPilotOperationalCode:
          dispatchPilot?.operational_code ??
          rememberedPilot?.operational_code ??
          rotation.suggested_pilot_operational_code,
        suggestedAircraftId:
          (dispatchPlanFresh ? rotation.forecast_assumed_aircraft_id : null) ??
          rotation.suggested_aircraft_id,
        suggestedAircraftRegistration:
          dispatchAircraft?.registration ?? rotation.suggested_aircraft_registration,
        ticketCount: rotation.ticket_count,
        baselineCapacity: rotation.baseline_capacity,
        usableCapacity: rotation.usable_capacity ?? rotation.baseline_capacity,
        capacityReduced:
          rotation.usable_capacity !== null &&
          rotation.usable_capacity < rotation.baseline_capacity,
        estimatedPassengerPayloadKg: rotation.estimated_passenger_payload_kg,
        predictedLowerMinutes,
        predictedUpperMinutes,
        boardingWindowLowerAt: boardingWindow.lowerAt,
        boardingWindowUpperAt: boardingWindow.upperAt,
        precalledAt: rotation.precalled_at,
        precallDecision:
          rotation.precall_decision_status &&
          rotation.precall_decision_reason &&
          rotation.precall_decision_at
            ? {
                status: rotation.precall_decision_status,
                reason: rotation.precall_dispatch_reason ?? rotation.precall_decision_reason,
                decidedAt: rotation.precall_decision_at,
                predictedBoardingAt: rotation.precall_predicted_boarding_at,
                adaptiveLeadMinutes: rotation.precall_adaptive_lead_minutes,
                gateId: rotation.precall_gate_id,
                adaptiveBaseLeadMinutes: rotation.precall_adaptive_base_lead_minutes,
                gateTravelLeadMinutes: rotation.precall_gate_travel_lead_minutes,
                effectiveLeadMinutes: rotation.precall_effective_lead_minutes,
                boardingWindowLowerAt: rotation.precall_boarding_window_lower_at,
                boardingWindowUpperAt: rotation.precall_boarding_window_upper_at,
              }
            : null,
        calledAt: rotation.called_at,
        dispatchPlan:
          dispatchPlanFresh && rotation.dispatch_plan_id && rotation.dispatch_plan_revision
            ? {
                planId: rotation.dispatch_plan_id,
                revision: rotation.dispatch_plan_revision,
                batchId: rotation.dispatch_batch_id,
                dispatchOrder: rotation.dispatch_order,
                wave: rotation.dispatch_wave,
                laneId: rotation.dispatch_lane_id,
                groupIds: JSON.parse(rotation.dispatch_group_ids_json) as string[],
                occupiedSeats: rotation.dispatch_occupied_seats,
                availableSeats: rotation.dispatch_available_seats,
                commitmentLevel: rotation.dispatch_commitment_level,
                decisionReasons: JSON.parse(rotation.dispatch_decision_reasons_json) as string[],
                confirmedOvertakeCount: rotation.dispatch_confirmed_overtake_count,
                projectedOvertakeCount: rotation.dispatch_projected_overtake_count,
                unplannedReason: rotation.dispatch_unplanned_reason,
              }
            : null,
        deferralCount: rotation.deferral_count,
        operationalNote: rotation.operational_note,
        timeline: {
          planned: {
            boardingAt: rotation.planned_boarding_at,
            departureAt: rotation.planned_departure_at,
            landingAt: rotation.planned_landing_at,
            completionAt: rotation.planned_completion_at,
          },
          predicted: {
            boardingAt: rotation.predicted_boarding_at,
            departureAt: rotation.predicted_departure_at,
            landingAt: rotation.predicted_landing_at,
            completionAt: rotation.predicted_completion_at,
          },
          actual: {
            boardingAt: rotation.called_at,
            departureAt: rotation.departed_at,
            landingAt: rotation.landed_at,
            completionAt: rotation.completed_at,
          },
          predictionQuality: effectivePredictionQuality,
          predictionUpdatedAt: rotation.prediction_updated_at,
          forecastAssumedAircraftId: rotation.forecast_assumed_aircraft_id,
          extendsBeyondOperationsEnd: overtimeMinutes > 0,
          overtimeMinutes,
          effectiveTurnaroundProfile,
        },
        tickets: JSON.parse(rotation.tickets_json) as Array<{
          id: string;
          status:
            | "QUEUED"
            | "CHECKED_IN"
            | "CALLED"
            | "BOARDING"
            | "IN_FLIGHT"
            | "LANDED"
            | "COMPLETED"
            | "NO_SHOW"
            | "CANCELED"
            | "CLARIFICATION";
          attendanceStatus: "NOT_CHECKED_IN" | "CHECKED_IN";
        }>,
      };
    }),
    queueGroups: queueGroupRows.results.map((group) => ({
      id: group.id,
      communicationNumber: group.communication_number,
      productId: group.product_id,
      productCode: group.product_code,
      productName: group.product_name,
      resourceGroupId: group.resource_group_id,
      gateId: group.gate_id,
      queueSequence: group.queue_sequence,
      status: group.status,
      ticketCount: group.ticket_count,
      presentCount: group.present_count,
      nextSegmentTicketCount: group.next_segment_ticket_count,
      nextSegmentPresentCount: group.next_segment_present_count,
      segmentIndex: group.segment_index,
      segmentCount: group.segment_count,
      precalledAt: group.precalled_at,
      dispatchReservation: dispatchReservationByGroupId.get(group.id) ?? null,
      recalledAt: group.recall_started_at,
      recallCount: group.recall_count,
      activeRecall: activeTicketGroupRecallProjection(group),
    })),
    aircraft: fleetRows.results.map((aircraft) => ({
      id: aircraft.id,
      version: aircraft.version,
      registration: aircraft.registration,
      aircraftType: aircraft.aircraft_type,
      passengerSeats: aircraft.passenger_seats,
      maximumPassengerPayloadKg: aircraft.maximum_passenger_payload_kg,
      operationalState:
        aircraft.operational_interrupted === 1 ? "INTERRUPTED" : aircraft.operational_state,
      operationalStateChangedAt: aircraft.operational_state_changed_at,
      resourceGroupId: aircraft.resource_group_id ?? "",
      resourceGroupName: aircraft.resource_group_name ?? "Nicht zugeordnet",
      resourceGroupShortCode: aircraft.resource_group_short_code ?? "–",
      refuelPlanned: aircraft.refuel_planned === 1,
      rotationsSinceRefuel: aircraft.rotations_since_refuel,
      refuelReminderThreshold: aircraft.refuel_reminder_threshold,
      expectedReviewAt: aircraft.expected_review_at,
      currentPilotId: aircraft.current_pilot_id,
      currentPilotOperationalCode: aircraft.current_pilot_operational_code,
    })),
    assistClaims: assistClaims.map((claim) => ({
      aircraftId: claim.aircraft_id,
      claimedByCurrentOperator:
        device.accountId !== null && claim.operator_account_id === device.accountId,
      ownerLoginCode: claim.login_code,
      revision: claim.revision,
      claimedAt: claim.claimed_at,
      expiresAt: claim.expires_at,
    })),
    pilots: pilotRows.results.map((pilot) => ({
      id: pilot.id,
      operationalCode: pilot.operational_code,
      operationalNote: pilot.operational_note,
      active: pilot.active === 1,
      paused: pilot.paused === 1,
      pauseExpectedReviewAt: pilot.pause_expected_review_at,
      currentRotationId: pilot.current_rotation_id,
      currentCommunicationNumber: pilot.current_communication_number,
    })),
    plannedOperations: plannedOperationRows.results.map((plan) => ({
      id: plan.id,
      version: plan.version,
      scopeType: plan.scope_type,
      scopeId: plan.scope_id,
      kind: plan.constraint_kind,
      effectMode: plan.effect_mode,
      durationMultiplierPercent: plan.duration_multiplier_percent,
      startMode: plan.start_mode,
      earliestStartAt: plan.earliest_start_at,
      latestStartAt: plan.latest_start_at,
      afterRotationId: plan.after_rotation_id,
      minimumDurationMinutes: plan.minimum_duration_minutes,
      typicalDurationMinutes: plan.typical_duration_minutes,
      maximumDurationMinutes: plan.maximum_duration_minutes,
      status:
        plan.status === "PLANNED" &&
        ((plan.latest_start_at !== null && Date.parse(plan.latest_start_at) <= Date.now()) ||
          (plan.start_mode === "AFTER_CURRENT_ROTATION" &&
            ["COMPLETED", "CANCELED"].includes(plan.after_rotation_status ?? "")))
          ? "DUE"
          : plan.status,
      publicNote: plan.public_note,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
      activatedAt: plan.activated_at,
      clearedAt: plan.cleared_at,
      canceledAt: plan.canceled_at,
      recurringRuleId: plan.recurring_rule_id,
      recurrenceSequence: plan.recurrence_sequence,
    })),
    recurringOperationalRules: recurringRuleRows.results.map((rule) => ({
      id: rule.id,
      operationDayId: rule.operation_day_id,
      version: rule.version,
      scopeType: rule.scope_type,
      scopeId: rule.scope_id,
      kind: rule.operation_kind,
      triggerMetric: rule.trigger_metric,
      intervalValue: rule.interval_value,
      progressValue: rule.progress_value,
      minimumDurationMinutes: rule.minimum_duration_minutes,
      typicalDurationMinutes: rule.typical_duration_minutes,
      maximumDurationMinutes: rule.maximum_duration_minutes,
      status: rule.status,
      sequenceNumber: rule.sequence_number,
      openPlannedOperationId: rule.open_plan_id,
      reason: rule.reason,
      lastResetAt: rule.last_reset_at,
      createdAt: rule.created_at,
      updatedAt: rule.updated_at,
    })),
    gates: gatesRows.results.map((gate) => ({
      id: gate.id,
      label: gate.label,
      gateType: gate.gate_type,
      active: gate.active === 1,
      sortOrder: gate.sort_order,
      travelLeadMinutes: gate.travel_lead_minutes,
      displayFilter: gateDisplayFilterSchema.parse(JSON.parse(gate.display_filter_json)),
      assignedResourceGroupIds: JSON.parse(gate.assigned_resource_group_ids_json) as string[],
    })),
    resourceGroups: resourceGroupRows.results.map((group) => {
      const activeAircraftIds = JSON.parse(group.aircraft_ids_json) as string[];
      const effectiveReferenceCapacity = Math.max(
        1,
        deriveResourceGroupCapacity(
          fleetRows.results
            .filter((aircraft) => activeAircraftIds.includes(aircraft.id))
            .map((aircraft) => aircraft.passenger_seats),
        ),
      );
      return {
        id: group.id,
        version: group.version,
        name: group.name,
        shortCode: group.short_code,
        status: group.status,
        operationalNote: group.operational_note,
        gateId: group.gate_id,
        gateLabel: group.gate_label,
        referenceCapacity: effectiveReferenceCapacity,
        compatibleAircraftTypes: [],
        automaticPrecallEnabled: group.automatic_precall_enabled === 1,
        activeAircraftIds,
      };
    }),
    metrics: {
      openTickets: metricsRow?.open_tickets ?? 0,
      soldTickets: metricsRow?.sold_tickets ?? 0,
      completedRotations: metricsRow?.completed_rotations ?? 0,
      activeRotations: metricsRow?.active_rotations ?? 0,
      averageBoardingMinutes: metricsRow?.average_boarding_minutes ?? null,
      averageFlightMinutes: metricsRow?.average_flight_minutes ?? null,
      averageTurnaroundMinutes: metricsRow?.average_turnaround_minutes ?? null,
      averageRotationMinutes: metricsRow?.average_rotation_minutes ?? null,
      averageWaitMinutes: metricsRow?.average_wait_minutes ?? null,
      informationalRevenueCents: metricsRow?.informational_revenue_cents ?? 0,
      activeDevices: metricsRow?.active_devices ?? 0,
      activePushSubscriptions: metricsRow?.active_push_subscriptions ?? 0,
    },
  });
  response.headers.set(
    "server-timing",
    `operations;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
  );
  return response;
});

registerAnalysisControlRoutes(app, eventCoordinatorNamespace);

registerTicketReadRoutes(app);

registerHistoryRoutes(app);
app.on("GET", eventRoutes("/devices"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (device?.role !== "ADMIN") {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const devices = await context.env.DB.prepare(
    `SELECT id, label, role, active, paired_at, last_seen_at, revoked_at
       FROM paired_devices WHERE operation_day_id = ?1 ORDER BY active DESC, paired_at DESC`,
  )
    .bind(eventId)
    .all<{
      id: string;
      label: string;
      role: string;
      active: number;
      paired_at: string;
      last_seen_at: string;
      revoked_at: string | null;
    }>();
  const now = Date.now();
  return context.json({
    devices: devices.results.map((entry) => ({
      id: entry.id,
      label: entry.label,
      role: entry.role,
      active: entry.active === 1,
      online: entry.active === 1 && now - Date.parse(entry.last_seen_at) <= 120_000,
      pairedAt: entry.paired_at,
      lastSeenAt: entry.last_seen_at,
      revokedAt: entry.revoked_at,
    })),
  });
});

registerReportExportRoutes(app);

registerPublicInstallRoutes(app);

registerPublicStatusRoutes(app, unknownTicketResponse);
registerPublicPushRoutes(app, unknownTicketResponse);
registerPublicBoardRoutes(app, eventCoordinatorNamespace);

app.on("GET", eventRoutes("/live"), async (context) => {
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor && context.env.APP_ENV !== "development") {
    return context.json(
      { error: { code: "SESSION_REQUIRED", message: "Anmeldung erforderlich." } },
      401,
    );
  }
  const eventId = context.req.param("eventId");
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const response = await stub.fetch(context.req.raw);
  return new Response(response.body, response);
});

app.on("POST", eventRoutes("/commands"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = context.get("sessionActor");
  if (!actor && context.env.APP_ENV !== "development") {
    return context.json(
      { error: { code: "SESSION_REQUIRED", message: "Anmeldung erforderlich." } },
      401,
    );
  }
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const target = new URL(context.req.url);
  target.pathname = `/internal/events/${encodeURIComponent(eventId)}/command`;
  if (!actor) {
    const response = await stub.fetch(new Request(target, context.req.raw));
    return new Response(response.body, response);
  }
  const command = (await context.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!command) {
    return context.json(
      { error: { code: "INVALID_COMMAND", message: "Kommando ist ungültig." } },
      400,
    );
  }
  const headers = new Headers(context.req.raw.headers);
  for (const name of [
    "x-device-id",
    "x-device-token",
    "x-operator-account-id",
    "x-operator-login-code",
    "x-operator-session-id",
    "x-operator-role",
    "x-operator-device-id",
  ])
    headers.delete(name);
  headers.set("content-type", "application/json");
  headers.set("x-operator-account-id", actor.accountId);
  headers.set("x-operator-login-code", actor.loginCode);
  headers.set("x-operator-session-id", actor.sessionId);
  headers.set("x-operator-role", actor.role);
  headers.set("x-operator-device-id", actor.deviceId);
  const response = await stub.fetch(
    new Request(target, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...command, deviceId: actor.deviceId }),
    }),
  );
  return new Response(response.body, response);
});

app.notFound((context) =>
  context.json({ error: { code: "NOT_FOUND", message: "API-Route nicht gefunden." } }, 404),
);

app.onError((error, context) => {
  if (error instanceof SyntaxError) {
    return context.json(
      { error: { code: "INVALID_JSON", message: "JSON-Anfrage ist ungültig." } },
      400,
    );
  }
  console.error(
    JSON.stringify({ level: "error", code: "UNHANDLED_API_ERROR", message: error.message }),
  );
  return context.json({ error: { code: "INTERNAL_ERROR", message: "Interner Fehler." } }, 500);
});

export { EventCoordinator };

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const purgedPushSubscriptions = await purgeExpiredPushSubscriptions(env);
    const now = new Date();
    const expiredAnalysisArchives = await expireAnalysisArchives(env, now);
    const builtAnalysisArchives = await processPendingAnalysisArchives(env);
    const nextOperationDate = operationDateInTimeZone(
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
    );
    const upcoming = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM operation_days
        WHERE event_date = ?1 AND status IN ('PREPARATION', 'ACTIVE')`,
    )
      .bind(nextOperationDate)
      .first<{ count: number }>();
    const backupReason = (upcoming?.count ?? 0) > 0 ? "PRE_EVENT" : "DAILY";
    const result = await createPortableBackup(env, now, backupReason);
    console.log(
      JSON.stringify({
        level: "info",
        code: "PORTABLE_BACKUP_CREATED",
        key: result.key,
        checksum: result.checksum,
        reason: backupReason,
        purgedPushSubscriptions,
        expiredAnalysisArchives,
        builtAnalysisArchives,
        timestamp: now.toISOString(),
      }),
    );
  },
};
