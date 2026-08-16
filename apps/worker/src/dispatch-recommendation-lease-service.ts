import {
  type DispatchRecommendationLeaseAcquire,
  dispatchRecommendationLeaseAcquireSchema,
} from "@rundflug/contracts";
import { type DeviceRole, compareTechnicalStrings as order } from "@rundflug/domain";
import { dispatchSegmentOrderSql } from "./dispatch-ordering-sql";
import {
  type DispatchRecommendationAircraft,
  type DispatchRecommendationPlanningRow,
  dispatchRecommendationLeaseResponse,
  planningGroupIndex,
  type StoredDispatchRecommendationLease,
  selectedDispatchBatch,
  strings,
} from "./dispatch-recommendation-lease-support";

export type { StoredDispatchRecommendationLease } from "./dispatch-recommendation-lease-support";

import {
  type DispatchRecommendationFallbackReason,
  type DispatchRecommendationSelectionSource,
  selectReusableDispatchBatch,
} from "./dispatch-recommendation-selection";
import type {
  ForecastRecalculationRequest,
  ForecastRecalculationResult,
} from "./forecast-timeline-service";
import type { Env } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const DISPATCH_RECOMMENDATION_LEASE_TTL_MS = 90_000;
const uniq = (values: string[]): string[] => [...new Set(values)];

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

function eventIdFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const eventsIndex = segments.indexOf("events");
  return eventsIndex >= 0 ? (segments[eventsIndex + 1] ?? null) : null;
}

export class DispatchRecommendationLeaseService {
  constructor(
    private readonly env: Env,
    private readonly waitUntil: (promise: Promise<unknown>) => void,
    private readonly getForecastWork: () => Promise<void> | null,
    private readonly recalculateForecastTimelines: (
      request: ForecastRecalculationRequest,
    ) => Promise<ForecastRecalculationResult>,
    private readonly scheduleForecastRecalculation: (
      eventId: string,
      triggerEventType: string,
    ) => Promise<void>,
  ) {}

  private async releaseLease(input: {
    leaseId: string | null;
    eventId: string;
    accountId: string;
    deviceId: string;
    now: Date;
    nowIso: string;
  }): Promise<Response> {
    if (!input.leaseId) {
      return json(
        { error: { code: "DISPATCH_LEASE_NOT_FOUND", message: "Reservierung fehlt." } },
        { status: 404 },
      );
    }
    const lease = await this.env.DB.prepare(
      `SELECT id, operation_day_id, aircraft_id, operator_account_id, device_id,
              acquire_command_id, dispatch_plan_revision, dispatch_batch_id, dispatch_order,
              ticket_group_ids_json, occupied_seats, available_seats, decision_reasons_json,
              decision_details_json,
              operation_day_version, member_rotation_ids_json,
              status, acquired_at, expires_at, version
         FROM dispatch_recommendation_leases
        WHERE id = ?1 AND operation_day_id = ?2`,
    )
      .bind(input.leaseId, input.eventId)
      .first<StoredDispatchRecommendationLease>();
    if (
      lease?.operator_account_id !== input.accountId ||
      lease.device_id !== input.deviceId ||
      lease.status !== "ACTIVE"
    ) {
      return new Response(null, { status: 204 });
    }
    const expired = Date.parse(lease.expires_at) <= input.now.getTime();
    const status = expired ? "EXPIRED" : "RELEASED";
    const eventType = expired
      ? "DISPATCH_RECOMMENDATION_LEASE_EXPIRED"
      : "DISPATCH_RECOMMENDATION_LEASE_RELEASED";
    const payload = {
      action: status,
      leaseId: lease.id,
      aircraftId: lease.aircraft_id,
      batchId: lease.dispatch_batch_id,
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE dispatch_recommendation_leases
            SET status = ?1, released_at = CASE WHEN ?1 = 'RELEASED' THEN ?2 ELSE released_at END,
                expired_at = CASE WHEN ?1 = 'EXPIRED' THEN ?2 ELSE expired_at END,
                version = version + 1
          WHERE id = ?3 AND status = 'ACTIVE' AND version = ?4`,
      ).bind(status, input.nowIso, lease.id, lease.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'DISPATCH_LEASE', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        input.eventId,
        eventType,
        input.nowIso,
        input.deviceId,
        lease.id,
        lease.version + 1,
        JSON.stringify(payload),
      ),
      this.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         VALUES (?1, ?2, 'DISPATCH_LEASE_CHANGED', ?3, ?4)`,
      ).bind(crypto.randomUUID(), input.eventId, JSON.stringify(payload), input.nowIso),
    ]);
    this.waitUntil(
      this.scheduleForecastRecalculation(input.eventId, "DISPATCH_RECOMMENDATION_LEASE_CHANGED"),
    );
    return new Response(null, { status: 204 });
  }

  private async repeatedAcquisitionResponse(input: {
    acquisition: DispatchRecommendationLeaseAcquire;
    eventId: string;
    accountId: string;
    deviceId: string;
    now: Date;
    nowIso: string;
  }): Promise<Response | null> {
    const repeated = await this.env.DB.prepare(
      `SELECT id, operation_day_id, aircraft_id, operator_account_id, device_id,
              acquire_command_id, dispatch_plan_revision, dispatch_batch_id, dispatch_order,
              ticket_group_ids_json, occupied_seats, available_seats, decision_reasons_json,
              decision_details_json,
              operation_day_version, member_rotation_ids_json,
              status, acquired_at, expires_at, version
         FROM dispatch_recommendation_leases
        WHERE acquire_command_id = ?1`,
    )
      .bind(input.acquisition.commandId)
      .first<StoredDispatchRecommendationLease>();
    if (!repeated) return null;
    const conflicts =
      repeated.operation_day_id !== input.eventId ||
      repeated.operator_account_id !== input.accountId ||
      repeated.device_id !== input.deviceId ||
      repeated.aircraft_id !== input.acquisition.aircraftId;
    if (conflicts) {
      return json(
        {
          error: {
            code: "IDEMPOTENCY_CONFLICT",
            message: "Kommando-ID ist bereits für eine andere Reservierung belegt.",
          },
        },
        { status: 409 },
      );
    }
    if (repeated.status === "ACTIVE" && Date.parse(repeated.expires_at) > input.now.getTime()) {
      return json(dispatchRecommendationLeaseResponse(repeated, input.nowIso));
    }
    return json(
      {
        error: {
          code: "DISPATCH_RECOMMENDATION_LEASE_FINISHED",
          message: "Diese Reservierungsanfrage ist bereits abgelaufen oder beendet.",
        },
      },
      { status: 409 },
    );
  }

  private async ownedLeaseResponse(input: {
    eventId: string;
    accountId: string;
    deviceId: string;
    aircraft: DispatchRecommendationAircraft;
    nowIso: string;
  }): Promise<Response | null> {
    const ownedLease = await this.env.DB.prepare(
      `SELECT id, operation_day_id, aircraft_id, operator_account_id, device_id,
              acquire_command_id, dispatch_plan_revision, dispatch_batch_id, dispatch_order,
              ticket_group_ids_json, occupied_seats, available_seats, decision_reasons_json,
              decision_details_json,
              operation_day_version, member_rotation_ids_json,
              status, acquired_at, expires_at, version
         FROM dispatch_recommendation_leases
        WHERE operation_day_id = ?1 AND operator_account_id = ?2 AND device_id = ?3
          AND status = 'ACTIVE' AND expires_at > ?4
        LIMIT 1`,
    )
      .bind(input.eventId, input.accountId, input.deviceId, input.nowIso)
      .first<StoredDispatchRecommendationLease>();
    if (!ownedLease) return null;
    if (ownedLease.aircraft_id !== input.aircraft.id) {
      return json(
        {
          error: {
            code: "DISPATCH_RECOMMENDATION_LEASE_ALREADY_HELD",
            message: "Dieses Gerät bereitet bereits eine andere Belegung vor.",
          },
        },
        { status: 409 },
      );
    }
    if (await this.dispatchRecommendationLeaseIsRelevant(ownedLease, input.aircraft)) {
      return json(dispatchRecommendationLeaseResponse(ownedLease, input.nowIso));
    }
    const payload = {
      action: "INVALIDATED",
      reason: "RELEVANT_STATE_CHANGED",
      leaseId: ownedLease.id,
      aircraftId: ownedLease.aircraft_id,
      batchId: ownedLease.dispatch_batch_id,
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE dispatch_recommendation_leases
            SET status = 'INVALIDATED', invalidated_at = ?1, version = version + 1
          WHERE id = ?2 AND status = 'ACTIVE' AND version = ?3`,
      ).bind(input.nowIso, ownedLease.id, ownedLease.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'DISPATCH_RECOMMENDATION_LEASE_INVALIDATED', ?3, ?4,
                 'DISPATCH_LEASE', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        input.eventId,
        input.nowIso,
        input.deviceId,
        ownedLease.id,
        ownedLease.version + 1,
        JSON.stringify(payload),
      ),
      this.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         VALUES (?1, ?2, 'DISPATCH_LEASE_CHANGED', ?3, ?4)`,
      ).bind(crypto.randomUUID(), input.eventId, JSON.stringify(payload), input.nowIso),
    ]);
    this.waitUntil(
      this.scheduleForecastRecalculation(input.eventId, "DISPATCH_RECOMMENDATION_LEASE_CHANGED"),
    );
    return null;
  }

  private async parseAcquisition(
    request: Request,
    eventVersion: number,
  ): Promise<{ acquisition: DispatchRecommendationLeaseAcquire } | { response: Response }> {
    const parsed = dispatchRecommendationLeaseAcquireSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return {
        response: json(
          {
            error: {
              code: "INVALID_DISPATCH_RECOMMENDATION_LEASE",
              message: "Reservierungsdaten sind ungültig.",
            },
          },
          { status: 400 },
        ),
      };
    }
    if (parsed.data.expectedVersion !== eventVersion) {
      return {
        response: json(
          {
            error: {
              code: "STALE_VERSION",
              message: "Betriebsstand wurde zwischenzeitlich geändert.",
              currentVersion: eventVersion,
            },
          },
          { status: 409 },
        ),
      };
    }
    return { acquisition: parsed.data };
  }

  private async loadEligibleAircraft(input: {
    aircraftId: string;
    eventId: string;
    accountId: string;
    role: DeviceRole;
    nowIso: string;
  }): Promise<{ aircraft: DispatchRecommendationAircraft } | { response: Response }> {
    const aircraft = await this.env.DB.prepare(
      `SELECT a.id, a.passenger_seats, a.operational_state, membership.resource_group_id,
              membership.current_pilot_id
         FROM aircraft a
         JOIN resource_group_memberships membership
           ON membership.aircraft_id = a.id AND membership.active_until IS NULL
        WHERE a.id = ?1 AND membership.operation_day_id = ?2`,
    )
      .bind(input.aircraftId, input.eventId)
      .first<DispatchRecommendationAircraft>();
    if (!aircraft) {
      return {
        response: json(
          { error: { code: "AIRCRAFT_NOT_FOUND", message: "Flugzeug nicht gefunden." } },
          { status: 404 },
        ),
      };
    }
    if (aircraft.operational_state !== "AVAILABLE") {
      return {
        response: json(
          {
            error: {
              code: "AIRCRAFT_NOT_AVAILABLE",
              message: "Das Flugzeug ist nicht mehr für eine neue Belegung verfügbar.",
            },
          },
          { status: 409 },
        ),
      };
    }
    if (input.role !== "FLIGHT_LINE") return { aircraft };
    const assistClaim = await this.env.DB.prepare(
      `SELECT aircraft_id
         FROM flight_line_assist_claims
        WHERE operation_day_id = ?1 AND operator_account_id = ?2
          AND aircraft_id = ?3 AND expires_at > ?4`,
    )
      .bind(input.eventId, input.accountId, aircraft.id, input.nowIso)
      .first<{ aircraft_id: string }>();
    if (assistClaim) return { aircraft };
    return {
      response: json(
        {
          error: {
            code: "AIRCRAFT_ASSIST_CLAIM_REQUIRED",
            message: "Das Flugzeug muss vor der Belegungsreservierung übernommen werden.",
          },
        },
        { status: 409 },
      ),
    };
  }

  private async ensureCanonicalPlan(input: {
    currentPlan: { dispatch_plan_revision: string } | null | undefined;
    eventId: string;
    eventVersion: number;
  }): Promise<boolean> {
    if (input.currentPlan) return false;
    await this.recalculateForecastTimelines({
      eventId: input.eventId,
      triggerEventType: "DISPATCH_RECOMMENDATION_REQUESTED",
      expectedEventVersion: input.eventVersion,
    });
    return true;
  }

  async eligibleDraftMembers(
    eventId: string,
    resourceGroupId: string,
  ): Promise<Array<{ rotationId: string; queueSequence: number }>> {
    const rows = await this.env.DB.prepare(
      `SELECT r.id AS rotation_id, r.created_at,
              ${dispatchSegmentOrderSql("r", "fg")} AS segment_order,
              fg.communication_number, COALESCE(MIN(tg.queue_sequence), 1) AS queue_sequence,
              COALESCE((SELECT json_group_array(group_ids.id) FROM (
                SELECT DISTINCT member_group.id
                  FROM rotation_tickets member_assignment
                  JOIN tickets member_ticket ON member_ticket.id = member_assignment.ticket_id
                  JOIN ticket_groups member_group ON member_group.id = member_ticket.ticket_group_id
                 WHERE member_assignment.rotation_id = r.id
                   AND member_assignment.released_at IS NULL
                 ORDER BY member_group.queue_sequence, member_group.id
              ) group_ids), '[]') AS group_ids_json
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         JOIN tickets t ON t.id = rt.ticket_id
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
        WHERE r.operation_day_id = ?1 AND r.status = 'DRAFT'
          AND fg.resource_group_id = ?2
        GROUP BY r.id
        HAVING MAX(
          CASE WHEN tg.status NOT IN ('QUEUED', 'PRESENT') THEN 1 ELSE 0 END
        ) = 0
        ORDER BY COALESCE(MIN(tg.queue_sequence), 2147483647),
                 MIN(tg.sold_at), r.created_at, r.id`,
    )
      .bind(eventId, resourceGroupId)
      .all<{
        rotation_id: string;
        created_at: string;
        segment_order: number;
        communication_number: number;
        queue_sequence: number;
        group_ids_json: string;
      }>();
    const segmentsByGroupId = new Map<string, typeof rows.results>();
    for (const row of rows.results) {
      for (const groupId of strings(row.group_ids_json)) {
        const segments = segmentsByGroupId.get(groupId) ?? [];
        segments.push(row);
        segmentsByGroupId.set(groupId, segments);
      }
    }
    const firstRotationByGroupId = new Map<string, string>();
    for (const [groupId, segments] of segmentsByGroupId) {
      segments.sort(
        (left, right) =>
          left.segment_order - right.segment_order ||
          left.created_at.localeCompare(right.created_at) ||
          left.rotation_id.localeCompare(right.rotation_id),
      );
      const first = segments[0];
      if (first) firstRotationByGroupId.set(groupId, first.rotation_id);
    }
    return rows.results.flatMap((row) => {
      const groupIds = strings(row.group_ids_json);
      return groupIds.length > 0 &&
        groupIds.every((groupId) => firstRotationByGroupId.get(groupId) === row.rotation_id)
        ? [{ rotationId: row.rotation_id, queueSequence: Number(row.queue_sequence) }]
        : [];
    });
  }

  private async dispatchRecommendationLeaseIsRelevant(
    lease: StoredDispatchRecommendationLease,
    aircraft: DispatchRecommendationAircraft,
  ): Promise<boolean> {
    if (aircraft.operational_state !== "AVAILABLE") return false;
    const leaseGroupIds = [...new Set(strings(lease.ticket_group_ids_json))].sort(order);
    const leaseMemberRotationIds = uniq(strings(lease.member_rotation_ids_json)).sort(order);
    if (leaseGroupIds.length === 0 || leaseMemberRotationIds.length === 0) return false;

    const rows = await this.env.DB.prepare(
      `SELECT tg.id AS ticket_group_id, r.id AS rotation_id, p.id AS product_id,
              p.resource_group_id, COALESCE(r.gate_id, p.gate_id) AS gate_id,
              COUNT(DISTINCT rt.ticket_id) AS ticket_count
         FROM ticket_groups tg
         JOIN products p ON p.id = tg.product_id
         JOIN tickets t ON t.ticket_group_id = tg.id
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
        WHERE tg.operation_day_id = ?1
          AND tg.id IN (SELECT value FROM json_each(?2))
          AND tg.status IN ('QUEUED', 'PRESENT')
          AND r.status = 'DRAFT'
          AND r.id = (
            SELECT candidate_rotation.id
              FROM tickets candidate_ticket
              JOIN rotation_tickets candidate_assignment
                ON candidate_assignment.ticket_id = candidate_ticket.id
               AND candidate_assignment.released_at IS NULL
              JOIN rotations candidate_rotation
                ON candidate_rotation.id = candidate_assignment.rotation_id
              JOIN flight_groups candidate_group
                ON candidate_group.id = candidate_rotation.flight_group_id
             WHERE candidate_ticket.ticket_group_id = tg.id
               AND candidate_rotation.status = 'DRAFT'
             GROUP BY candidate_rotation.id, candidate_group.queue_position
             ORDER BY ${dispatchSegmentOrderSql("candidate_rotation", "candidate_group")},
                      candidate_rotation.created_at, candidate_rotation.id
             LIMIT 1
          )
        GROUP BY tg.id, r.id, p.id, p.resource_group_id, COALESCE(r.gate_id, p.gate_id)`,
    )
      .bind(lease.operation_day_id, JSON.stringify(leaseGroupIds))
      .all<{
        ticket_group_id: string;
        rotation_id: string;
        product_id: string;
        resource_group_id: string;
        gate_id: string;
        ticket_count: number;
      }>();
    const liveGroupIds = rows.results.map((row) => row.ticket_group_id).sort(order);
    const liveMemberRotationIds = uniq(rows.results.map((row) => row.rotation_id)).sort(order);
    const liveSeatCount = rows.results.reduce((sum, row) => sum + Number(row.ticket_count), 0);
    return (
      liveGroupIds.length === leaseGroupIds.length &&
      liveGroupIds.every((groupId, index) => groupId === leaseGroupIds[index]) &&
      liveMemberRotationIds.length === leaseMemberRotationIds.length &&
      liveMemberRotationIds.every(
        (rotationId, index) => rotationId === leaseMemberRotationIds[index],
      ) &&
      liveSeatCount === lease.occupied_seats &&
      liveSeatCount <= aircraft.passenger_seats &&
      new Set(rows.results.map((row) => row.product_id)).size === 1 &&
      new Set(rows.results.map((row) => row.gate_id)).size === 1 &&
      rows.results.every((row) => row.resource_group_id === aircraft.resource_group_id)
    );
  }

  async handleRequest(request: Request, url: URL): Promise<Response> {
    const eventId = eventIdFromPath(url.pathname);
    const segments = url.pathname.split("/").filter(Boolean);
    const leaseIndex = segments.indexOf("dispatch-recommendation-leases");
    const leaseId = leaseIndex >= 0 ? (segments[leaseIndex + 1] ?? null) : null;
    const accountId = request.headers.get("x-operator-account-id");
    const deviceId = request.headers.get("x-operator-device-id");
    const role = request.headers.get("x-operator-role") as DeviceRole | null;
    if (!eventId || !accountId || !deviceId || !role) {
      return json(
        { error: { code: "SESSION_NOT_AUTHORIZED", message: "Anmeldung erforderlich." } },
        { status: 401 },
      );
    }
    if (!["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"].includes(role)) {
      return json(
        { error: { code: "ROLE_NOT_AUTHORIZED", message: "Sitzung ist nicht berechtigt." } },
        { status: 403 },
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const event = await this.env.DB.prepare("SELECT version FROM operation_days WHERE id = ?1")
      .bind(eventId)
      .first<{ version: number }>();
    if (!event) {
      return json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        { status: 404 },
      );
    }

    if (request.method === "DELETE") {
      return this.releaseLease({ leaseId, eventId, accountId, deviceId, now, nowIso });
    }

    const acquisitionResult = await this.parseAcquisition(request, event.version);
    if ("response" in acquisitionResult) return acquisitionResult.response;
    const acquisition = acquisitionResult.acquisition;

    const repeatedResponse = await this.repeatedAcquisitionResponse({
      acquisition,
      eventId,
      accountId,
      deviceId,
      now,
      nowIso,
    });
    if (repeatedResponse) return repeatedResponse;

    const aircraftResult = await this.loadEligibleAircraft({
      aircraftId: acquisition.aircraftId,
      eventId,
      accountId,
      role,
      nowIso,
    });
    if ("response" in aircraftResult) return aircraftResult.response;
    const aircraft = aircraftResult.aircraft;

    const ownedLeaseResponse = await this.ownedLeaseResponse({
      eventId,
      accountId,
      deviceId,
      aircraft,
      nowIso,
    });
    if (ownedLeaseResponse) return ownedLeaseResponse;

    const aircraftLease = await this.env.DB.prepare(
      `SELECT lease.id
         FROM dispatch_recommendation_leases lease
        WHERE lease.operation_day_id = ?1 AND lease.aircraft_id = ?2
          AND lease.status = 'ACTIVE' AND lease.expires_at > ?3
        LIMIT 1`,
    )
      .bind(eventId, aircraft.id, nowIso)
      .first<{ id: string }>();
    if (aircraftLease) {
      return json(
        {
          error: {
            code: "AIRCRAFT_DISPATCH_RECOMMENDATION_LEASED",
            message: "Für dieses Flugzeug wird bereits eine Belegung vorbereitet.",
          },
        },
        { status: 409 },
      );
    }

    const forecastWork = this.getForecastWork();
    if (forecastWork !== null) await forecastWork;
    const currentCanonicalPlan = await this.env.DB.prepare(
      `SELECT run.dispatch_plan_revision
         FROM planning_runs run
        WHERE run.operation_day_id = ?1
          AND run.operation_day_version = ?2
          AND run.status = 'SUCCEEDED'
          AND EXISTS (
            SELECT 1 FROM rotations planned_rotation
             WHERE planned_rotation.operation_day_id = run.operation_day_id
               AND planned_rotation.status = 'DRAFT'
               AND planned_rotation.dispatch_plan_revision = run.dispatch_plan_revision
          )
          AND NOT EXISTS (
            SELECT 1 FROM dispatch_recommendation_leases active_lease
             WHERE active_lease.operation_day_id = run.operation_day_id
               AND active_lease.status = 'ACTIVE'
               AND active_lease.expires_at > ?3
               AND active_lease.acquired_at > run.calculation_now
          )
        ORDER BY run.calculation_now DESC, run.id DESC
        LIMIT 1`,
    )
      .bind(eventId, event.version, nowIso)
      .first<{ dispatch_plan_revision: string }>();
    const canonicalPlanReplanned = await this.ensureCanonicalPlan({
      currentPlan: currentCanonicalPlan,
      eventId,
      eventVersion: event.version,
    });

    const planningRows = await this.env.DB.prepare(
      `SELECT r.id AS rotation_id, r.created_at,
              ${dispatchSegmentOrderSql("r", "fg")} AS segment_order,
              fg.communication_number, COALESCE(MIN(tg.queue_sequence), 1) AS queue_sequence,
              p.id AS product_id,
              COALESCE(r.gate_id, p.gate_id) AS gate_id,
              COALESCE((SELECT json_group_array(group_ids.id) FROM (
                SELECT DISTINCT member_group.id
                  FROM rotation_tickets member_assignment
                  JOIN tickets member_ticket ON member_ticket.id = member_assignment.ticket_id
                  JOIN ticket_groups member_group ON member_group.id = member_ticket.ticket_group_id
                 WHERE member_assignment.rotation_id = r.id
                   AND member_assignment.released_at IS NULL
                 ORDER BY member_group.queue_sequence, member_group.id
              ) group_ids), '[]') AS group_ids_json,
              COALESCE(MIN(tg.sold_at), r.created_at) AS sold_at,
              MAX(COALESCE(tg.standby, 0)) AS standby,
              CASE
                WHEN MAX(CASE WHEN tg.status = 'MISSING' THEN 1 ELSE 0 END) = 1 THEN 'MISSING'
                WHEN MAX(CASE WHEN tg.status = 'CLARIFICATION' THEN 1 ELSE 0 END) = 1
                  THEN 'CLARIFICATION'
                WHEN COUNT(DISTINCT rt.ticket_id) > 0
                  AND SUM(CASE WHEN t.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END)
                    = COUNT(DISTINCT rt.ticket_id) THEN 'PRESENT'
                ELSE 'WAITING'
              END AS attendance_status,
              COUNT(DISTINCT rt.ticket_id) AS ticket_count,
              COALESCE(p.reference_duration_minutes, 20) AS reference_duration_minutes,
              fg.precalled_at, fg.precall_decision_status,
              r.dispatch_plan_revision, r.dispatch_batch_id, r.dispatch_order, r.dispatch_wave,
              r.dispatch_group_ids_json, r.dispatch_occupied_seats,
              r.dispatch_decision_reasons_json, r.dispatch_decision_details_json,
              r.dispatch_confirmed_overtake_count,
              r.dispatch_projected_overtake_count, r.prediction_updated_at,
              CASE WHEN EXISTS (
                SELECT 1
                  FROM dispatch_recommendation_leases active_lease
                 WHERE active_lease.operation_day_id = r.operation_day_id
                   AND active_lease.status = 'ACTIVE'
                   AND active_lease.expires_at > ?3
                   AND (
                     EXISTS (
                       SELECT 1 FROM json_each(active_lease.member_rotation_ids_json) member
                        WHERE member.value = r.id
                     ) OR EXISTS (
                       SELECT 1 FROM json_each(active_lease.ticket_group_ids_json) reserved_group
                        WHERE reserved_group.value IN (
                          SELECT reserved_ticket.ticket_group_id
                            FROM rotation_tickets reserved_assignment
                            JOIN tickets reserved_ticket
                              ON reserved_ticket.id = reserved_assignment.ticket_id
                           WHERE reserved_assignment.rotation_id = r.id
                             AND reserved_assignment.released_at IS NULL
                        )
                     )
                   )
              ) THEN 1 ELSE 0 END AS reserved_by_active_lease
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN products p ON p.id = fg.product_id
         JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         JOIN tickets t ON t.id = rt.ticket_id
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
        WHERE r.operation_day_id = ?1 AND r.status = 'DRAFT'
          AND fg.resource_group_id = ?2
        GROUP BY r.id
        HAVING MAX(
          CASE WHEN tg.status NOT IN ('QUEUED', 'PRESENT', 'MISSING', 'CLARIFICATION')
            THEN 1 ELSE 0 END
        ) = 0
        ORDER BY COALESCE(MIN(tg.queue_sequence), 2147483647),
                 MIN(tg.sold_at), r.created_at, r.id`,
    )
      .bind(eventId, aircraft.resource_group_id, nowIso)
      .all<DispatchRecommendationPlanningRow>();
    const { groupIdsByRotationId, firstRotationByGroupId } = planningGroupIndex(
      planningRows.results,
    );
    const reusableSelection = selectReusableDispatchBatch({
      aircraftPassengerSeats: aircraft.passenger_seats,
      rows: planningRows.results.map((row) => ({
        rotationId: row.rotation_id,
        groupIds: groupIdsByRotationId.get(row.rotation_id) ?? [],
        productId: row.product_id,
        gateId: row.gate_id,
        ticketCount: Number(row.ticket_count),
        attendanceStatus: row.attendance_status,
        calledToGate: row.precalled_at !== null || row.precall_decision_status === "GO_TO_GATE",
        firstEligibleSegment: (groupIdsByRotationId.get(row.rotation_id) ?? []).every(
          (groupId) => firstRotationByGroupId.get(groupId) === row.rotation_id,
        ),
        reservedByActiveLease: row.reserved_by_active_lease === 1,
        planRevision: row.dispatch_plan_revision,
        batchId: row.dispatch_batch_id,
        dispatchOrder: row.dispatch_order,
        dispatchWave: row.dispatch_wave,
        plannedGroupIds: strings(row.dispatch_group_ids_json),
        plannedOccupiedSeats: row.dispatch_occupied_seats,
        decisionReasons: strings(row.dispatch_decision_reasons_json),
        decisionDetails: row.dispatch_decision_details_json
          ? JSON.parse(row.dispatch_decision_details_json)
          : null,
        predictionUpdatedAt: row.prediction_updated_at,
      })),
    });
    const selectionSource: DispatchRecommendationSelectionSource = canonicalPlanReplanned
      ? "CANONICAL_REPLAN"
      : "CURRENT_PLAN_BATCH";
    const fallbackReason: DispatchRecommendationFallbackReason | null =
      reusableSelection.fallbackReason;
    const selectedBatch = selectedDispatchBatch(reusableSelection);
    const selectedPlanRevision = selectedBatch.planRevision;
    const selectedBatchId = selectedBatch.batchId;
    const selectedDispatchOrder = selectedBatch.dispatchOrder;
    const selectedMemberRotationIds = selectedBatch.memberRotationIds;
    const selectedGroupIds = selectedBatch.groupIds;
    const selectedOccupiedSeats = selectedBatch.occupiedSeats;
    const selectedDecisionReasons = selectedBatch.decisionReasons;
    const selectedDecisionDetails = selectedBatch.decisionDetails;
    if (selectedGroupIds.length === 0) {
      return json(
        {
          error: {
            code: "DISPATCH_RECOMMENDATION_NOT_AVAILABLE",
            message: "Aktuell ist kein unreservierter, passender Belegungsvorschlag verfügbar.",
          },
        },
        { status: 409 },
      );
    }

    const memberRotationIds = selectedMemberRotationIds;
    const distinctCandidateGroupIds = selectedGroupIds;
    const liveOccupiedSeats = selectedOccupiedSeats;

    const expiredLeases = await this.env.DB.prepare(
      `SELECT id, aircraft_id, dispatch_batch_id, version
         FROM dispatch_recommendation_leases
        WHERE operation_day_id = ?1 AND status = 'ACTIVE' AND expires_at <= ?2`,
    )
      .bind(eventId, nowIso)
      .all<{ id: string; aircraft_id: string; dispatch_batch_id: string; version: number }>();
    const leaseIdValue = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + DISPATCH_RECOMMENDATION_LEASE_TTL_MS).toISOString();
    const groupIds = distinctCandidateGroupIds;
    const decisionReasons = selectedDecisionReasons;
    if (groupIds.length === 0) {
      return json(
        {
          error: {
            code: "DISPATCH_RECOMMENDATION_INVALID",
            message: "Der aktuelle Belegungsvorschlag enthält keine Gruppen.",
          },
        },
        { status: 409 },
      );
    }
    const lease: StoredDispatchRecommendationLease = {
      id: leaseIdValue,
      operation_day_id: eventId,
      aircraft_id: aircraft.id,
      operator_account_id: accountId,
      device_id: deviceId,
      acquire_command_id: acquisition.commandId,
      dispatch_plan_revision: selectedPlanRevision,
      dispatch_batch_id: selectedBatchId,
      dispatch_order: selectedDispatchOrder,
      ticket_group_ids_json: JSON.stringify(groupIds),
      occupied_seats: liveOccupiedSeats,
      available_seats: Math.max(0, aircraft.passenger_seats - liveOccupiedSeats),
      decision_reasons_json: JSON.stringify(decisionReasons),
      decision_details_json: selectedDecisionDetails
        ? JSON.stringify(selectedDecisionDetails)
        : null,
      operation_day_version: event.version,
      member_rotation_ids_json: JSON.stringify(memberRotationIds),
      status: "ACTIVE",
      acquired_at: nowIso,
      expires_at: expiresAt,
      version: 1,
    };
    const expirationStatements = expiredLeases.results.flatMap((expiredLease) => {
      const payload = {
        action: "EXPIRED",
        leaseId: expiredLease.id,
        aircraftId: expiredLease.aircraft_id,
        batchId: expiredLease.dispatch_batch_id,
      };
      return [
        this.env.DB.prepare(
          `UPDATE dispatch_recommendation_leases
              SET status = 'EXPIRED', expired_at = ?1, version = version + 1
            WHERE id = ?2 AND status = 'ACTIVE' AND version = ?3`,
        ).bind(nowIso, expiredLease.id, expiredLease.version),
        this.env.DB.prepare(
          `INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
             aggregate_id, aggregate_version, payload_json)
           VALUES (?1, ?2, 'DISPATCH_RECOMMENDATION_LEASE_EXPIRED', ?3, ?4,
                   'DISPATCH_LEASE', ?5, ?6, ?7)`,
        ).bind(
          crypto.randomUUID(),
          eventId,
          nowIso,
          deviceId,
          expiredLease.id,
          expiredLease.version + 1,
          JSON.stringify(payload),
        ),
      ];
    });
    const payload = {
      action: "ACQUIRED",
      leaseId: lease.id,
      aircraftId: lease.aircraft_id,
      batchId: lease.dispatch_batch_id,
      planRevision: lease.dispatch_plan_revision,
      groupIds,
      expiresAt,
      selectionSource,
      fallbackReason,
    };
    await this.env.DB.batch([
      ...expirationStatements,
      this.env.DB.prepare(
        `INSERT INTO dispatch_recommendation_leases
          (id, operation_day_id, aircraft_id, operator_account_id, device_id,
           acquire_command_id, dispatch_plan_revision, dispatch_batch_id, dispatch_order,
           ticket_group_ids_json, occupied_seats, available_seats, decision_reasons_json,
           decision_details_json,
           operation_day_version, member_rotation_ids_json,
           status, acquired_at, expires_at, version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                 ?14, ?15, ?16, 'ACTIVE', ?17, ?18, 1)`,
      ).bind(
        lease.id,
        eventId,
        lease.aircraft_id,
        accountId,
        deviceId,
        lease.acquire_command_id,
        lease.dispatch_plan_revision,
        lease.dispatch_batch_id,
        lease.dispatch_order,
        lease.ticket_group_ids_json,
        lease.occupied_seats,
        lease.available_seats,
        lease.decision_reasons_json,
        lease.decision_details_json,
        lease.operation_day_version,
        lease.member_rotation_ids_json,
        nowIso,
        expiresAt,
      ),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'DISPATCH_RECOMMENDATION_LEASE_ACQUIRED', ?3, ?4,
                 'DISPATCH_LEASE', ?5, 1, ?6)`,
      ).bind(crypto.randomUUID(), eventId, nowIso, deviceId, lease.id, JSON.stringify(payload)),
      this.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         VALUES (?1, ?2, 'DISPATCH_LEASE_CHANGED', ?3, ?4)`,
      ).bind(crypto.randomUUID(), eventId, JSON.stringify(payload), nowIso),
    ]);
    this.waitUntil(
      this.scheduleForecastRecalculation(eventId, "DISPATCH_RECOMMENDATION_LEASE_CHANGED"),
    );
    return json(dispatchRecommendationLeaseResponse(lease, nowIso));
  }
}
