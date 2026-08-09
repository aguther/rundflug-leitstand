import {
  assessForecastFreshness,
  derivePublicForecastProjection,
  derivePublicRotationStatus,
  formatBookingGroupLabel,
} from "@rundflug/domain";
import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import {
  bookingGroupPartContextFromColumns,
  withBookingGroupPartProjection,
} from "./booking-group-part-projection";
import { sha256Hex } from "./crypto";
import { PUBLIC_STATUS_MESSAGES, publicServicePausedMessage } from "./public-status-copy";
import {
  activeTicketGroupRecallProjection,
  predictedBoardingWindow,
} from "./public-status-projection";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

type RotationStatus = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
type PredictionQuality = "STABLE" | "CHANGING" | "UNCERTAIN";
type ResourceGroupStatus = "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
type DispatchUnplannedReason =
  | "NO_FORECAST_CAPACITY"
  | "WAITING_FOR_FITTING_LANE"
  | "WAITING_FOR_PRODUCT_FAIRNESS"
  | "NOT_IN_NEAR_DISPATCH_BATCH"
  | "COMMITMENT_LOCKED"
  | "ATTENDANCE_MISSING"
  | "ATTENDANCE_CLARIFICATION"
  | "UNKNOWN_RESOURCE_RETURN";

interface TicketStatusRow {
  product_name: string;
  product_code: string;
  public_description: string;
  gate_label: string;
  communication_number: number;
  part_number: number;
  part_count: number;
  passenger_count: number;
  precalled_at: string | null;
  precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
  status: RotationStatus;
  operation_day_id: string;
  queue_sequence: number;
  predicted_boarding_at: string | null;
  predicted_completion_at: string | null;
  prediction_quality: PredictionQuality | null;
  prediction_lower_minutes: number | null;
  prediction_upper_minutes: number | null;
  prediction_updated_at: string | null;
  dispatch_batch_id: string | null;
  dispatch_unplanned_reason: DispatchUnplannedReason | null;
  updated_at: string;
  event_name: string;
  time_zone: string;
  event_operational_note: string;
  resource_group_operational_note: string;
  planned_public_note: string | null;
  operational_interrupted: number;
  emergency_mode: number;
  notification_lead_minutes: number;
  operations_end_at: string | null;
  resource_group_status: ResourceGroupStatus;
  recall_id: string | null;
  recall_sequence: number | null;
  recall_started_at: string | null;
  recall_expires_at: string | null;
}

interface GroupStatusRow {
  id: string;
  communication_number: number;
  operation_day_id: string;
  product_name: string;
  product_code: string;
  public_description: string;
  gate_label: string;
  event_name: string;
  time_zone: string;
  event_operational_note: string;
  operational_interrupted: number;
  emergency_mode: number;
  notification_lead_minutes: number;
  operations_end_at: string | null;
  updated_at: string;
  resource_group_status: ResourceGroupStatus;
  resource_group_operational_note: string;
  planned_public_note: string | null;
  group_size: number;
  recall_id: string | null;
  recall_sequence: number | null;
  recall_started_at: string | null;
  recall_expires_at: string | null;
}

interface GroupRotationRow {
  id: string;
  status: RotationStatus;
  predicted_boarding_at: string | null;
  predicted_completion_at: string | null;
  prediction_quality: PredictionQuality | null;
  prediction_lower_minutes: number | null;
  prediction_upper_minutes: number | null;
  prediction_updated_at: string | null;
  dispatch_batch_id: string | null;
  dispatch_unplanned_reason: DispatchUnplannedReason | null;
  precalled_at: string | null;
  precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
  queue_position: number;
  gate_label: string;
  part_number: number;
  part_count: number;
  passenger_count: number;
}

type UnknownTicketResponse = (env: Env, request: Request) => Promise<Response>;

export function registerPublicStatusRoutes(
  app: WorkerApp,
  unknownTicketResponse: UnknownTicketResponse,
) {
  app.get("/api/public/tickets/:ticketCode", async (context) => {
    const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
    if (!/^[A-Z2-9]{12,32}$/.test(ticketCode)) {
      return unknownTicketResponse(context.env, context.req.raw);
    }
    const ticketHash = await sha256Hex(ticketCode);
    const row = await context.env.DB.prepare(
      withBookingGroupPartProjection(
        `SELECT p.name AS product_name, p.code AS product_code, p.public_description,
              g.label AS gate_label,
              COALESCE(tg.communication_number, fg.communication_number) AS communication_number,
              part.part_number, part.part_count, part.passenger_count,
              fg.precalled_at, fg.precall_decision_status, r.status, tg.operation_day_id,
              COALESCE(fg.queue_position, tg.queue_sequence) AS queue_sequence,
              r.predicted_boarding_at, r.predicted_completion_at, r.prediction_quality,
              r.prediction_lower_minutes, r.prediction_upper_minutes,
              r.prediction_updated_at, r.dispatch_batch_id, r.dispatch_unplanned_reason,
              od.name AS event_name, od.time_zone,
              od.operational_note AS event_operational_note, od.operational_interrupted,
              od.emergency_mode, od.notification_lead_minutes, od.operations_end_at,
              rg.status AS resource_group_status,
              rg.operational_note AS resource_group_operational_note,
              recall.id AS recall_id, recall.sequence AS recall_sequence,
              recall.started_at AS recall_started_at, recall.expires_at AS recall_expires_at,
              (SELECT plan.public_note FROM planned_operational_constraints plan
                WHERE plan.operation_day_id = od.id AND plan.status = 'ACTIVE'
                  AND plan.public_note <> ''
                  AND ((plan.scope_type = 'RESOURCE_GROUP' AND plan.scope_id = rg.id)
                    OR (plan.scope_type = 'EVENT' AND plan.scope_id = od.id))
                ORDER BY CASE plan.scope_type WHEN 'RESOURCE_GROUP' THEN 0 ELSE 1 END,
                         plan.activated_at DESC LIMIT 1) AS planned_public_note,
              od.updated_at
         FROM tickets t
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         JOIN products p ON p.id = tg.product_id
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
         JOIN booking_group_parts part
           ON part.ticket_group_id = tg.id AND part.rotation_id = r.id
         JOIN gates g ON g.id = COALESCE(r.gate_id, p.gate_id)
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rg ON rg.id = fg.resource_group_id
         JOIN operation_days od ON od.id = tg.operation_day_id
         LEFT JOIN ticket_group_recalls recall
           ON recall.ticket_group_id = tg.id
          AND recall.ended_at IS NULL
          AND recall.expires_at > ?2
        WHERE t.public_code_hash = ?1`,
      ),
    )
      .bind(ticketHash, new Date().toISOString())
      .first<TicketStatusRow>();
    if (!row) {
      return unknownTicketResponse(context.env, context.req.raw);
    }
    const forecastFreshness = assessForecastFreshness({
      predictionQuality: row.prediction_quality,
      predictionUpdatedAt: row.prediction_updated_at,
      now: new Date().toISOString(),
    });
    const effectivePredictionQuality =
      row.emergency_mode === 1 ||
      row.operational_interrupted === 1 ||
      row.resource_group_status === "INTERRUPTED" ||
      row.resource_group_status === "ENDED"
        ? "UNCERTAIN"
        : forecastFreshness.quality;
    const prepare =
      row.status === "DRAFT" &&
      row.resource_group_status === "ACTIVE" &&
      row.operational_interrupted === 0 &&
      effectivePredictionQuality !== "UNCERTAIN" &&
      row.precall_decision_status === "PREPARE";
    const publicStatus = derivePublicRotationStatus({
      rotationState: row.status,
      draftStatus: row.precalled_at ? "COME_TO_FLIGHT_LINE" : prepare ? "PREPARE" : "WAITING",
    });
    const servicePaused =
      row.emergency_mode === 1 ||
      row.operational_interrupted === 1 ||
      row.resource_group_status !== "ACTIVE";
    const lowerMinutes = row.prediction_lower_minutes ?? Math.max(0, (row.queue_sequence - 1) * 20);
    const upperMinutes = row.prediction_upper_minutes ?? row.queue_sequence * 30;
    const boardingWindow = predictedBoardingWindow({
      status: row.status,
      quality: effectivePredictionQuality,
      predictedBoardingAt: row.predicted_boarding_at,
      lowerMinutes,
      upperMinutes,
      referenceAt: new Date().toISOString(),
    });
    const publicForecast = derivePublicForecastProjection({
      rotationStatus: row.status,
      predictionQuality: effectivePredictionQuality,
      predictedBoardingAt: row.predicted_boarding_at,
      predictedCompletionAt: row.predicted_completion_at,
      operationsEndAt: row.operations_end_at,
      dispatchBatchId: row.dispatch_batch_id,
      dispatchUnplannedReason: row.dispatch_unplanned_reason,
      emergencyMode: row.emergency_mode === 1,
      operationalInterrupted: row.operational_interrupted === 1,
      resourceGroupStatus: row.resource_group_status,
    });
    const publishesWindow =
      publicForecast.forecastState === "DISPATCH_WINDOW" ||
      publicForecast.forecastState === "LONG_RANGE_WINDOW";
    return context.json({
      eventId: row.operation_day_id,
      eventName: row.event_name,
      productName: row.product_name,
      productCode: row.product_code,
      publicDescription: row.public_description,
      gateLabel: row.gate_label,
      communicationNumber: row.communication_number,
      bookingGroupPart: bookingGroupPartContextFromColumns(row),
      status: servicePaused ? "SERVICE_PAUSED" : publicStatus,
      queuePosition: row.emergency_mode === 0 && row.status === "DRAFT" ? row.queue_sequence : null,
      waitLowerMinutes:
        row.emergency_mode === 0 &&
        row.resource_group_status === "ACTIVE" &&
        row.status === "DRAFT" &&
        row.operational_interrupted === 0 &&
        publishesWindow
          ? lowerMinutes
          : 0,
      waitUpperMinutes:
        row.emergency_mode === 0 &&
        row.resource_group_status === "ACTIVE" &&
        row.status === "DRAFT" &&
        row.operational_interrupted === 0 &&
        publishesWindow
          ? upperMinutes
          : 0,
      boardingWindowLowerAt: publishesWindow ? boardingWindow.lowerAt : null,
      boardingWindowUpperAt: publishesWindow ? boardingWindow.upperAt : null,
      ...publicForecast,
      timeZone: row.time_zone,
      predictionQuality: effectivePredictionQuality,
      message: servicePaused
        ? publicServicePausedMessage({
            emergencyMode: row.emergency_mode === 1,
            resourceGroupActive: row.resource_group_status === "ACTIVE",
            operationalInterrupted: row.operational_interrupted === 1,
          })
        : forecastFreshness.reason === "STALE_PREDICTION"
          ? "Prognose wird aktualisiert – bitte Status erneut prüfen."
          : PUBLIC_STATUS_MESSAGES[publicStatus],
      operationalNotice:
        row.planned_public_note ||
        row.resource_group_operational_note ||
        row.event_operational_note,
      activeRecall: activeTicketGroupRecallProjection(row),
      updatedAt: row.updated_at,
    });
  });

  app.get("/api/public/groups/:groupCode", async (context) => {
    const groupCode = context.req.param("groupCode").trim().toUpperCase();
    if (!/^[A-Z2-9]{12,32}$/.test(groupCode)) {
      return unknownTicketResponse(context.env, context.req.raw);
    }
    const group = await context.env.DB.prepare(
      `SELECT tg.id, tg.communication_number, tg.operation_day_id,
              p.name AS product_name, p.code AS product_code, p.public_description,
              g.label AS gate_label,
              od.name AS event_name, od.time_zone, od.operational_note AS event_operational_note,
              od.operational_interrupted, od.emergency_mode, od.notification_lead_minutes,
              od.operations_end_at,
              od.updated_at, rg.status AS resource_group_status,
              rg.operational_note AS resource_group_operational_note,
              recall.id AS recall_id, recall.sequence AS recall_sequence,
              recall.started_at AS recall_started_at, recall.expires_at AS recall_expires_at,
              (SELECT plan.public_note FROM planned_operational_constraints plan
                WHERE plan.operation_day_id = od.id AND plan.status = 'ACTIVE'
                  AND plan.public_note <> ''
                  AND ((plan.scope_type = 'RESOURCE_GROUP' AND plan.scope_id = rg.id)
                    OR (plan.scope_type = 'EVENT' AND plan.scope_id = od.id))
                ORDER BY CASE plan.scope_type WHEN 'RESOURCE_GROUP' THEN 0 ELSE 1 END,
                         plan.activated_at DESC LIMIT 1) AS planned_public_note,
              (SELECT COUNT(*) FROM tickets t WHERE t.ticket_group_id = tg.id) AS group_size
         FROM ticket_groups tg
         JOIN products p ON p.id = tg.product_id
         JOIN gates g ON g.id = p.gate_id
         JOIN resource_groups rg ON rg.id = p.resource_group_id
         JOIN operation_days od ON od.id = tg.operation_day_id
         LEFT JOIN ticket_group_recalls recall
           ON recall.ticket_group_id = tg.id
          AND recall.ended_at IS NULL
          AND recall.expires_at > ?2
        WHERE tg.public_status_code_hash = ?1 AND tg.status <> 'CANCELED'`,
    )
      .bind(await sha256Hex(groupCode), new Date().toISOString())
      .first<GroupStatusRow>();
    if (!group) {
      return unknownTicketResponse(context.env, context.req.raw);
    }

    const rotations = await context.env.DB.prepare(
      withBookingGroupPartProjection(
        `SELECT r.id, r.status, r.predicted_boarding_at, r.predicted_completion_at,
              r.prediction_quality,
              r.prediction_lower_minutes, r.prediction_upper_minutes, r.prediction_updated_at,
              r.dispatch_batch_id, r.dispatch_unplanned_reason,
              fg.precalled_at, fg.precall_decision_status,
              COALESCE(fg.queue_position, fg.communication_number) AS queue_position,
              g.label AS gate_label, part.part_number, part.part_count, part.passenger_count
         FROM booking_group_parts part
         JOIN rotations r ON r.id = part.rotation_id
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN ticket_groups part_tg ON part_tg.id = part.ticket_group_id
         JOIN products part_product ON part_product.id = part_tg.product_id
         JOIN gates g ON g.id = COALESCE(r.gate_id, part_product.gate_id)
        WHERE part.ticket_group_id = ?1
        ORDER BY part.part_number`,
      ),
    )
      .bind(group.id)
      .all<GroupRotationRow>();
    if (rotations.results.length === 0) {
      return unknownTicketResponse(context.env, context.req.raw);
    }

    const readAt = new Date().toISOString();
    const servicePaused =
      group.emergency_mode === 1 ||
      group.operational_interrupted === 1 ||
      group.resource_group_status !== "ACTIVE";
    const parts = rotations.results.map((rotation) => {
      const freshness = assessForecastFreshness({
        predictionQuality: rotation.prediction_quality,
        predictionUpdatedAt: rotation.prediction_updated_at,
        now: readAt,
      });
      const predictionQuality =
        group.emergency_mode === 1 ||
        group.operational_interrupted === 1 ||
        group.resource_group_status === "INTERRUPTED" ||
        group.resource_group_status === "ENDED"
          ? "UNCERTAIN"
          : freshness.quality;
      const lowerMinutes =
        rotation.prediction_lower_minutes ?? Math.max(0, (rotation.queue_position - 1) * 20);
      const upperMinutes =
        rotation.prediction_upper_minutes ?? Math.max(lowerMinutes, rotation.queue_position * 30);
      const prepare =
        rotation.status === "DRAFT" &&
        predictionQuality !== "UNCERTAIN" &&
        rotation.precall_decision_status === "PREPARE";
      const lifecycleStatus = derivePublicRotationStatus({
        rotationState: rotation.status,
        draftStatus: rotation.precalled_at
          ? "COME_TO_FLIGHT_LINE"
          : prepare
            ? "PREPARE"
            : "WAITING",
      });
      const publicStatus = servicePaused ? ("SERVICE_PAUSED" as const) : lifecycleStatus;
      const lifecycleMessage = PUBLIC_STATUS_MESSAGES[lifecycleStatus];
      const boardingWindow = predictedBoardingWindow({
        status: rotation.status,
        quality: predictionQuality,
        predictedBoardingAt: rotation.predicted_boarding_at,
        lowerMinutes,
        upperMinutes,
        referenceAt: readAt,
      });
      const publicForecast = derivePublicForecastProjection({
        rotationStatus: rotation.status,
        predictionQuality,
        predictedBoardingAt: rotation.predicted_boarding_at,
        predictedCompletionAt: rotation.predicted_completion_at,
        operationsEndAt: group.operations_end_at,
        dispatchBatchId: rotation.dispatch_batch_id,
        dispatchUnplannedReason: rotation.dispatch_unplanned_reason,
        emergencyMode: group.emergency_mode === 1,
        operationalInterrupted: group.operational_interrupted === 1,
        resourceGroupStatus: group.resource_group_status,
      });
      const publishesWindow =
        publicForecast.forecastState === "DISPATCH_WINDOW" ||
        publicForecast.forecastState === "LONG_RANGE_WINDOW";
      const message = servicePaused
        ? publicServicePausedMessage({
            emergencyMode: group.emergency_mode === 1,
            resourceGroupActive: group.resource_group_status === "ACTIVE",
            operationalInterrupted: group.operational_interrupted === 1,
          })
        : freshness.reason === "STALE_PREDICTION"
          ? "Prognose wird aktualisiert – bitte Status erneut prüfen."
          : lifecycleMessage;
      const partContext = bookingGroupPartContextFromColumns(rotation);
      if (!partContext) {
        throw new Error("Canonical booking group part projection is incomplete.");
      }
      return {
        ...partContext,
        gateLabel: rotation.gate_label,
        status: publicStatus,
        queuePosition: rotation.status === "DRAFT" ? rotation.queue_position : null,
        boardingWindowLowerAt: publishesWindow ? boardingWindow.lowerAt : null,
        boardingWindowUpperAt: publishesWindow ? boardingWindow.upperAt : null,
        ...publicForecast,
        predictionQuality,
        message,
      };
    });

    return context.json({
      eventId: group.operation_day_id,
      eventName: group.event_name,
      bookingGroupLabel: formatBookingGroupLabel(group.product_code, group.communication_number),
      groupSize: group.group_size,
      productName: group.product_name,
      productCode: group.product_code,
      publicDescription: group.public_description,
      timeZone: group.time_zone,
      operationalNotice:
        group.planned_public_note ||
        group.resource_group_operational_note ||
        group.event_operational_note,
      activeRecall: activeTicketGroupRecallProjection(group),
      updatedAt: group.updated_at,
      parts,
    });
  });
}
