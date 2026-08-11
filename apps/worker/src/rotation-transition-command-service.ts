import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import {
  assertProductPureSelection,
  type ConfirmedOvertakeIncrement,
  calculateConfirmedOvertakeIncrements,
  DomainRuleError,
  compareTechnicalStrings as order,
  resolveTurnaroundProfile,
  transitionRotation,
} from "@rundflug/domain";
import { dispatchSegmentOrderSql } from "./dispatch-ordering-sql";
import type { StoredDispatchRecommendationLease } from "./dispatch-recommendation-lease-service";
import { rowToSnapshot } from "./snapshot";
import type {
  StoredTicketGroupRecall,
  TicketGroupRecallClosureInput,
} from "./ticket-group-recall-persistence-service";
import type { Env, StoredEventRow } from "./types";
import { sendRotationPushNotifications } from "./web-push";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export type RotationTransitionCommand = Extract<
  CommandEnvelope,
  {
    type:
      | "CALL_NEXT"
      | "MARK_OFF_BLOCK"
      | "MARK_ON_BLOCK"
      | "COMPLETE_TURNAROUND"
      | "CANCEL_ROTATION";
  }
>;

export class RotationTransitionCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcastResult: (result: CommandResult) => void,
    private readonly waitUntil: (promise: Promise<unknown>) => void,
    private readonly loadOpenTicketGroupRecalls: (
      eventId: string,
      ticketGroupIds: readonly string[],
      onlyUnexpiredAt?: string,
    ) => Promise<StoredTicketGroupRecall[]>,
    private readonly ticketGroupRecallClosureStatements: (
      input: TicketGroupRecallClosureInput,
    ) => D1PreparedStatement[],
    private readonly loadEligibleDraftMembers: (
      eventId: string,
      resourceGroupId: string,
    ) => Promise<Array<{ rotationId: string; queueSequence: number }>>,
  ) {}

  async handle(
    command: RotationTransitionCommand,
    current: StoredEventRow,
    operatorAccountId: string | null,
  ): Promise<Response> {
    const primaryAssignment =
      command.type === "CALL_NEXT"
        ? await this.env.DB.prepare(
            `SELECT r.id AS rotation_id
               FROM ticket_groups tg
               JOIN tickets t ON t.ticket_group_id = tg.id
               JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
               JOIN rotations r ON r.id = rt.rotation_id
               JOIN flight_groups fg ON fg.id = r.flight_group_id
              WHERE tg.operation_day_id = ?1 AND tg.id = ?2
                AND r.status = 'DRAFT'
              GROUP BY r.id, fg.queue_position
              ORDER BY ${dispatchSegmentOrderSql("r", "fg")}, r.created_at, r.id
              LIMIT 1`,
          )
            .bind(command.eventId, command.payload.ticketGroupIds[0])
            .first<{ rotation_id: string }>()
        : null;
    const rotationId =
      command.type === "CALL_NEXT" ? primaryAssignment?.rotation_id : command.payload.rotationId;
    if (!rotationId) {
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Keine ausgewählte Gruppe gefunden." } },
        { status: 404 },
      );
    }
    const rotation = await this.env.DB.prepare(
      `SELECT r.id, r.status, r.version, r.aircraft_id, r.pilot_id, r.called_at,
              r.forecast_assumed_aircraft_id, r.dispatch_plan_revision,
              r.dispatch_batch_id, r.dispatch_group_ids_json,
              (SELECT snapshot.operation_day_version
                 FROM forecast_snapshots snapshot
                WHERE snapshot.rotation_id = r.id
                  AND snapshot.dispatch_plan_revision = r.dispatch_plan_revision
                ORDER BY snapshot.captured_at DESC, snapshot.id DESC
                LIMIT 1) AS dispatch_operation_day_version,
              fg.product_id AS flight_group_product_id, rg.status AS resource_group_status
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rg ON rg.id = fg.resource_group_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2`,
    )
      .bind(rotationId, command.eventId)
      .first<{
        id: string;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED" | "CANCELED";
        version: number;
        aircraft_id: string | null;
        pilot_id: string | null;
        called_at: string | null;
        forecast_assumed_aircraft_id: string | null;
        dispatch_plan_revision: string | null;
        dispatch_batch_id: string | null;
        dispatch_group_ids_json: string;
        dispatch_operation_day_version: number | null;
        flight_group_product_id: string | null;
        resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
      }>();
    if (!rotation)
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." } },
        { status: 404 },
      );
    let selectedGroups: Array<{
      ticket_group_id: string;
      rotation_id: string;
      resource_group_id: string;
      product_id: string;
      queue_sequence: number;
      ticket_count: number;
    }> = [];
    let skippedEarlierTicketGroupIds: string[] = [];
    let acceptedDispatchRecommendation = false;
    let acceptedDispatchRecommendationLease: StoredDispatchRecommendationLease | null = null;
    let manualOverrideLeases: StoredDispatchRecommendationLease[] = [];
    let manualOverrideReason: string | null = null;
    let confirmedOvertakeIncrements: ConfirmedOvertakeIncrement[] = [];
    let confirmedTurnaroundProductId: string | null = null;
    let confirmedTurnaroundProfile: ReturnType<typeof resolveTurnaroundProfile> | null = null;
    if (command.type === "CALL_NEXT") {
      if (rotation.resource_group_status !== "ACTIVE") {
        return json(
          {
            error: {
              code: "RESOURCE_GROUP_NOT_ACTIVE",
              message: "Ressourcengruppe ist für neue Aufrufe nicht aktiv.",
            },
          },
          { status: 409 },
        );
      }
      const distinctGroupIds = [...new Set(command.payload.ticketGroupIds)];
      if (distinctGroupIds.length !== command.payload.ticketGroupIds.length) {
        return json(
          {
            error: {
              code: "DUPLICATE_TICKET_GROUP",
              message: "Eine Gruppe wurde mehrfach gewählt.",
            },
          },
          { status: 400 },
        );
      }
      const placeholders = distinctGroupIds.map((_, index) => `?${index + 2}`).join(", ");
      const groupResult = await this.env.DB.prepare(
        `SELECT tg.id AS ticket_group_id, r.id AS rotation_id,
                tg.product_id, tg.queue_sequence, p.resource_group_id, COUNT(t.id) AS ticket_count
           FROM ticket_groups tg
           JOIN products p ON p.id = tg.product_id
           JOIN tickets t ON t.ticket_group_id = tg.id
           JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
           JOIN rotations r ON r.id = rt.rotation_id
           JOIN flight_groups fg ON fg.id = r.flight_group_id
          WHERE tg.operation_day_id = ?1 AND tg.id IN (${placeholders})
            AND tg.status IN ('QUEUED', 'PRESENT')
            AND r.status = 'DRAFT'
            AND r.id = (
              SELECT candidate_rotation.id
                FROM tickets candidate_ticket
                JOIN rotation_tickets candidate_assignment
                  ON candidate_assignment.ticket_id = candidate_ticket.id
                 AND candidate_assignment.released_at IS NULL
                JOIN rotations candidate_rotation ON candidate_rotation.id = candidate_assignment.rotation_id
                JOIN flight_groups candidate_group ON candidate_group.id = candidate_rotation.flight_group_id
               WHERE candidate_ticket.ticket_group_id = tg.id
                 AND candidate_rotation.status = 'DRAFT'
               GROUP BY candidate_rotation.id, candidate_group.queue_position
               ORDER BY ${dispatchSegmentOrderSql("candidate_rotation", "candidate_group")},
                        candidate_rotation.created_at, candidate_rotation.id
               LIMIT 1
            )
          GROUP BY tg.id, r.id, tg.product_id, tg.queue_sequence, p.resource_group_id`,
      )
        .bind(command.eventId, ...distinctGroupIds)
        .all<{
          ticket_group_id: string;
          rotation_id: string;
          resource_group_id: string;
          product_id: string;
          queue_sequence: number;
          ticket_count: number;
        }>();
      selectedGroups = groupResult.results;
      if (selectedGroups.length !== distinctGroupIds.length) {
        return json(
          {
            error: {
              code: "TICKET_GROUP_NOT_AVAILABLE",
              message: "Mindestens eine Gruppe ist nicht mehr in der Warteschlange verfügbar.",
            },
          },
          { status: 409 },
        );
      }
      if (new Set(selectedGroups.map((group) => group.resource_group_id)).size !== 1) {
        return json(
          {
            error: {
              code: "RESOURCE_GROUP_MISMATCH",
              message: "Ausgewählte Gruppen gehören nicht zur gleichen Ressourcengruppe.",
            },
          },
          { status: 409 },
        );
      }
      const leaseId = command.payload.dispatchRecommendationLeaseId;
      if (leaseId) {
        if (!operatorAccountId || !command.payload.dispatchRecommendation) {
          return json(
            {
              error: {
                code: "DISPATCH_RECOMMENDATION_LEASE_MISMATCH",
                message: "Die Vorschlagsreservierung gehört nicht zu dieser Bestätigung.",
              },
            },
            { status: 409 },
          );
        }
        const lease = await this.env.DB.prepare(
          `SELECT id, operation_day_id, aircraft_id, operator_account_id, device_id,
                  acquire_command_id, dispatch_plan_revision, dispatch_batch_id,
                  dispatch_order, ticket_group_ids_json, occupied_seats, available_seats,
                  decision_reasons_json, operation_day_version, member_rotation_ids_json,
                  status, acquired_at, expires_at, version
             FROM dispatch_recommendation_leases
            WHERE id = ?1 AND operation_day_id = ?2`,
        )
          .bind(leaseId, command.eventId)
          .first<StoredDispatchRecommendationLease>();
        if (lease?.status !== "ACTIVE") {
          return json(
            {
              error: {
                code: "DISPATCH_RECOMMENDATION_LEASE_CONFLICT",
                message: "Die Vorschlagsreservierung ist nicht mehr aktiv.",
              },
            },
            { status: 409 },
          );
        }
        if (Date.parse(lease.expires_at) <= Date.now()) {
          return json(
            {
              error: {
                code: "DISPATCH_RECOMMENDATION_LEASE_EXPIRED",
                message: "Die Vorschlagsreservierung ist abgelaufen. Bitte neu reservieren.",
              },
            },
            { status: 409 },
          );
        }
        const leaseGroupIds = (JSON.parse(lease.ticket_group_ids_json) as string[]).sort(order);
        const leaseMemberRotationIds = (
          JSON.parse(lease.member_rotation_ids_json) as string[]
        ).sort(order);
        const selectedGroupIds = [...distinctGroupIds].sort(order);
        const selectedMemberRotationIds = [
          ...new Set(selectedGroups.map((group) => group.rotation_id)),
        ].sort(order);
        const selectedSeatCount = selectedGroups.reduce(
          (sum, group) => sum + Number(group.ticket_count),
          0,
        );
        const leaseMatches =
          lease.operator_account_id === operatorAccountId &&
          lease.device_id === command.deviceId &&
          lease.aircraft_id === command.payload.aircraftId &&
          lease.dispatch_plan_revision === command.payload.dispatchRecommendation.planRevision &&
          lease.dispatch_batch_id === command.payload.dispatchRecommendation.batchId &&
          leaseGroupIds.length === selectedGroupIds.length &&
          leaseGroupIds.every(
            (ticketGroupId, index) => ticketGroupId === selectedGroupIds[index],
          ) &&
          leaseMemberRotationIds.length === selectedMemberRotationIds.length &&
          leaseMemberRotationIds.every(
            (rotationId, index) => rotationId === selectedMemberRotationIds[index],
          ) &&
          lease.occupied_seats === selectedSeatCount;
        if (!leaseMatches) {
          return json(
            {
              error: {
                code: "DISPATCH_RECOMMENDATION_LEASE_MISMATCH",
                message:
                  "Die reservierte Belegung passt nicht mehr zum aktuellen Zustand. Bitte aktuellen Vorschlag laden.",
              },
            },
            { status: 409 },
          );
        }
        acceptedDispatchRecommendation = true;
        acceptedDispatchRecommendationLease = lease;
      } else if (command.payload.dispatchRecommendation) {
        const recommendedGroupIds = JSON.parse(rotation.dispatch_group_ids_json) as string[];
        const selectedGroupIds = [...distinctGroupIds].sort(order);
        const currentRecommendedGroupIds = [...recommendedGroupIds].sort(order);
        acceptedDispatchRecommendation =
          rotation.dispatch_operation_day_version === current.version &&
          rotation.dispatch_plan_revision === command.payload.dispatchRecommendation.planRevision &&
          rotation.dispatch_batch_id === command.payload.dispatchRecommendation.batchId &&
          rotation.forecast_assumed_aircraft_id === command.payload.aircraftId &&
          selectedGroupIds.length === currentRecommendedGroupIds.length &&
          selectedGroupIds.every(
            (ticketGroupId, index) => ticketGroupId === currentRecommendedGroupIds[index],
          );
        if (!acceptedDispatchRecommendation) {
          return json(
            {
              error: {
                code: "DISPATCH_PLAN_STALE",
                message:
                  "Die Belegungsempfehlung wurde inzwischen neu berechnet. Bitte aktuellen Plan prüfen.",
                currentPlanRevision: rotation.dispatch_plan_revision,
                currentBatchId: rotation.dispatch_batch_id,
              },
            },
            { status: 409 },
          );
        }
      }
      if (!leaseId) {
        const selectedGroupIdsJson = JSON.stringify(distinctGroupIds);
        const conflictingLeases = await this.env.DB.prepare(
          `SELECT lease.id, lease.operation_day_id, lease.aircraft_id,
                  lease.operator_account_id, lease.device_id, lease.acquire_command_id,
                  lease.dispatch_plan_revision, lease.dispatch_batch_id, lease.dispatch_order,
                  lease.ticket_group_ids_json, lease.occupied_seats, lease.available_seats,
                  lease.decision_reasons_json, lease.operation_day_version,
                  lease.member_rotation_ids_json, lease.status, lease.acquired_at,
                  lease.expires_at, lease.version
             FROM dispatch_recommendation_leases lease
            WHERE lease.operation_day_id = ?1
              AND lease.status = 'ACTIVE'
              AND lease.expires_at > ?2
              AND EXISTS (
                SELECT 1
                  FROM json_each(lease.ticket_group_ids_json) reserved_group
                  JOIN json_each(?3) selected_group
                    ON selected_group.value = reserved_group.value
              )
            ORDER BY lease.acquired_at, lease.id`,
        )
          .bind(command.eventId, new Date().toISOString(), selectedGroupIdsJson)
          .all<StoredDispatchRecommendationLease>();
        manualOverrideLeases = conflictingLeases.results;
        manualOverrideReason = command.payload.queueDeviationReason?.trim() ?? null;
        if (manualOverrideLeases.length > 0 && !manualOverrideReason) {
          return json(
            {
              error: {
                code: "QUEUE_DEVIATION_REASON_REQUIRED",
                message:
                  "Für die manuelle Übersteuerung eines reservierten Vorschlags ist ein Grund erforderlich.",
              },
            },
            { status: 409 },
          );
        }
      }
      let selectedProductId: string;
      try {
        selectedProductId = assertProductPureSelection(
          selectedGroups.map((group) => group.product_id),
        );
      } catch (reason: unknown) {
        if (!(reason instanceof DomainRuleError)) throw reason;
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      if (
        rotation.flight_group_product_id !== null &&
        rotation.flight_group_product_id !== selectedProductId
      ) {
        return json(
          {
            error: {
              code: "PRODUCT_MISMATCH",
              message: "Die Fluggruppe gehört nicht zum Produkt der ausgewählten Ticketgruppen.",
            },
          },
          { status: 409 },
        );
      }
      const turnaroundConfiguration = await this.env.DB.prepare(
        `SELECT p.planned_boarding_minutes_override AS product_boarding,
                p.planned_deboarding_minutes_override AS product_deboarding,
                p.planned_buffer_minutes_override AS product_buffer,
                override.planned_boarding_minutes_override AS aircraft_boarding,
                override.planned_deboarding_minutes_override AS aircraft_deboarding,
                override.planned_buffer_minutes_override AS aircraft_buffer
           FROM products p
           LEFT JOIN aircraft_product_turnaround_overrides override
             ON override.operation_day_id = p.operation_day_id
            AND override.product_id = p.id
            AND override.aircraft_id = ?3
          WHERE p.id = ?1 AND p.operation_day_id = ?2`,
      )
        .bind(selectedProductId, command.eventId, command.payload.aircraftId)
        .first<{
          product_boarding: number | null;
          product_deboarding: number | null;
          product_buffer: number | null;
          aircraft_boarding: number | null;
          aircraft_deboarding: number | null;
          aircraft_buffer: number | null;
        }>();
      if (!turnaroundConfiguration) {
        return json(
          { error: { code: "PRODUCT_NOT_FOUND", message: "Produkt nicht gefunden." } },
          { status: 404 },
        );
      }
      confirmedTurnaroundProductId = selectedProductId;
      confirmedTurnaroundProfile = resolveTurnaroundProfile({
        event: {
          sourceId: command.eventId,
          boardingMinutes: current.planned_boarding_minutes ?? 8,
          deboardingMinutes: current.planned_deboarding_minutes ?? 5,
          bufferMinutes: current.planned_buffer_minutes ?? 3,
        },
        product: {
          sourceId: selectedProductId,
          boardingMinutes: turnaroundConfiguration.product_boarding,
          deboardingMinutes: turnaroundConfiguration.product_deboarding,
          bufferMinutes: turnaroundConfiguration.product_buffer,
        },
        aircraftProduct: {
          sourceId: `${command.payload.aircraftId}:${selectedProductId}`,
          boardingMinutes: turnaroundConfiguration.aircraft_boarding,
          deboardingMinutes: turnaroundConfiguration.aircraft_deboarding,
          bufferMinutes: turnaroundConfiguration.aircraft_buffer,
        },
      });
      const earliestSelectedQueueSequence = Math.min(
        ...selectedGroups.map((group) => Number(group.queue_sequence)),
      );
      const skippedEarlierResult = await this.env.DB.prepare(
        `SELECT tg.id
           FROM ticket_groups tg
           JOIN products p ON p.id = tg.product_id
          WHERE tg.operation_day_id = ?1
            AND p.resource_group_id = ?2
            AND tg.product_id <> ?3
            AND tg.queue_sequence < ?4
            AND tg.status IN ('QUEUED', 'PRESENT')
            AND EXISTS (
              SELECT 1
                FROM tickets earlier_ticket
                JOIN rotation_tickets earlier_assignment
                  ON earlier_assignment.ticket_id = earlier_ticket.id
                 AND earlier_assignment.released_at IS NULL
                JOIN rotations earlier_rotation
                  ON earlier_rotation.id = earlier_assignment.rotation_id
               WHERE earlier_ticket.ticket_group_id = tg.id
                 AND earlier_rotation.status = 'DRAFT'
            )
          ORDER BY tg.queue_sequence, tg.id`,
      )
        .bind(
          command.eventId,
          selectedGroups[0]?.resource_group_id,
          selectedProductId,
          earliestSelectedQueueSequence,
        )
        .all<{ id: string }>();
      skippedEarlierTicketGroupIds = skippedEarlierResult.results.map((group) => group.id);
      if (
        skippedEarlierTicketGroupIds.length > 0 &&
        !acceptedDispatchRecommendation &&
        !command.payload.queueDeviationReason?.trim()
      ) {
        return json(
          {
            error: {
              code: "QUEUE_DEVIATION_REASON_REQUIRED",
              message:
                "Für das Überspringen früherer Ticketgruppen eines anderen Produkts ist ein Grund erforderlich.",
            },
          },
          { status: 409 },
        );
      }
      const candidate = await this.env.DB.prepare(
        `SELECT a.id, a.passenger_seats, a.operational_state,
                membership.current_pilot_id
           FROM rotations r
           JOIN flight_groups fg ON fg.id = r.flight_group_id
           JOIN resource_group_memberships membership
             ON membership.resource_group_id = fg.resource_group_id
            AND membership.operation_day_id = r.operation_day_id
            AND membership.active_until IS NULL
           JOIN aircraft a ON a.id = membership.aircraft_id
          WHERE r.id = ?1 AND a.id = ?2
          GROUP BY a.id`,
      )
        .bind(rotation.id, command.payload.aircraftId)
        .first<{
          id: string;
          passenger_seats: number;
          operational_state: string;
          current_pilot_id: string | null;
        }>();
      if (candidate?.operational_state !== "AVAILABLE") {
        return json(
          { error: { code: "AIRCRAFT_NOT_AVAILABLE", message: "Flugzeug ist nicht verfügbar." } },
          { status: 409 },
        );
      }
      const selectedTicketCount = selectedGroups.reduce(
        (sum, group) => sum + Number(group.ticket_count),
        0,
      );
      if (selectedTicketCount > candidate.passenger_seats) {
        return json(
          {
            error: {
              code: "AIRCRAFT_CAPACITY_EXCEEDED",
              message: "Flugzeugkapazität reicht nicht aus.",
            },
          },
          { status: 409 },
        );
      }
      if (!candidate.current_pilot_id || candidate.current_pilot_id !== command.payload.pilotId) {
        return json(
          {
            error: {
              code: "AIRCRAFT_PILOT_ASSIGNMENT_MISMATCH",
              message:
                "Der bestätigte Pilotencode entspricht nicht der Pilotenzuweisung am Flugzeug.",
            },
          },
          { status: 409 },
        );
      }
      const pilot = await this.env.DB.prepare(
        `SELECT p.id FROM pilots p
          WHERE p.id = ?1 AND p.operation_day_id = ?2 AND p.active = 1 AND p.paused = 0
            AND NOT EXISTS (
              SELECT 1 FROM rotations active_rotation
               WHERE active_rotation.operation_day_id = p.operation_day_id
                 AND active_rotation.pilot_id = p.id
                 AND active_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
            )`,
      )
        .bind(command.payload.pilotId, command.eventId)
        .first<{ id: string }>();
      if (!pilot) {
        return json(
          {
            error: {
              code: "PILOT_NOT_AVAILABLE",
              message: "Pilotencode ist nicht aktiv verfügbar.",
            },
          },
          { status: 409 },
        );
      }
    }
    const target = {
      CALL_NEXT: "CALLED",
      MARK_OFF_BLOCK: "IN_FLIGHT",
      MARK_ON_BLOCK: "LANDED",
      COMPLETE_TURNAROUND: "COMPLETED",
      CANCEL_ROTATION: "CANCELED",
    } as const;
    const timestampColumn = {
      CALL_NEXT: "called_at",
      MARK_OFF_BLOCK: "departed_at",
      MARK_ON_BLOCK: "landed_at",
      COMPLETE_TURNAROUND: "completed_at",
      CANCEL_ROTATION: "completed_at",
    } as const;
    let nextState: typeof rotation.status;
    try {
      nextState = transitionRotation(rotation.status, target[command.type]);
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError)
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      throw reason;
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType = {
      CALL_NEXT: "FLIGHT_GROUP_CALLED",
      MARK_OFF_BLOCK: "MARK_OFF_BLOCK",
      MARK_ON_BLOCK: "MARK_ON_BLOCK",
      COMPLETE_TURNAROUND: "TURNAROUND_COMPLETED",
      CANCEL_ROTATION: "ROTATION_CANCELED",
    } as const;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: eventType[command.type],
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    const recallClosures =
      command.type === "CALL_NEXT"
        ? await this.loadOpenTicketGroupRecalls(
            command.eventId,
            selectedGroups.map((group) => group.ticket_group_id),
            now,
          )
        : [];
    const selectedAircraftId =
      command.type === "CALL_NEXT" ? command.payload.aircraftId : rotation.aircraft_id;
    if (!selectedAircraftId) {
      return json(
        { error: { code: "AIRCRAFT_ASSIGNMENT_REQUIRED", message: "Flugzeugzuordnung fehlt." } },
        { status: 409 },
      );
    }
    const selectedPilotId =
      command.type === "CALL_NEXT" ? command.payload.pilotId : rotation.pilot_id;
    if (!selectedPilotId) {
      return json(
        { error: { code: "PILOT_ASSIGNMENT_REQUIRED", message: "Pilotenzuordnung fehlt." } },
        { status: 409 },
      );
    }
    const aircraftState =
      command.type === "COMPLETE_TURNAROUND"
        ? command.payload.nextAircraftState
        : {
            CALL_NEXT: "BOARDING",
            MARK_OFF_BLOCK: "IN_FLIGHT",
            MARK_ON_BLOCK: "LANDED",
            CANCEL_ROTATION: "AVAILABLE",
          }[command.type];
    if (command.type === "CALL_NEXT") {
      const selectedMemberQueueSequence = new Map<string, number>();
      for (const group of selectedGroups) {
        selectedMemberQueueSequence.set(
          group.rotation_id,
          Math.min(
            selectedMemberQueueSequence.get(group.rotation_id) ?? Number.MAX_SAFE_INTEGER,
            Number(group.queue_sequence),
          ),
        );
      }
      const waitingMembers = await this.loadEligibleDraftMembers(
        command.eventId,
        selectedGroups[0]?.resource_group_id ?? "",
      );
      confirmedOvertakeIncrements = calculateConfirmedOvertakeIncrements({
        selectedMembers: [...selectedMemberQueueSequence].map(([rotationId, queueSequence]) => ({
          rotationId,
          queueSequence,
        })),
        waitingMembers,
      });
    }
    const confirmedOvertakeStatements = confirmedOvertakeIncrements.map((entry) =>
      this.env.DB.prepare(
        `UPDATE rotations
            SET dispatch_confirmed_overtake_count =
                  dispatch_confirmed_overtake_count + ?1
          WHERE id = ?2 AND operation_day_id = ?3 AND status = 'DRAFT'`,
      ).bind(entry.increment, entry.rotationId, command.eventId),
    );
    const groupMoveStatements =
      command.type === "CALL_NEXT"
        ? selectedGroups
            .filter((group) => group.rotation_id !== rotation.id)
            .flatMap((group) => [
              this.env.DB.prepare(
                `UPDATE rotation_tickets SET released_at = ?1
                  WHERE rotation_id = ?2 AND released_at IS NULL
                    AND ticket_id IN (SELECT id FROM tickets WHERE ticket_group_id = ?3)`,
              ).bind(now, group.rotation_id, group.ticket_group_id),
              this.env.DB.prepare(
                `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
                 SELECT ?1, moved_assignment.ticket_id, ?2
                   FROM rotation_tickets moved_assignment
                   JOIN tickets moved_ticket ON moved_ticket.id = moved_assignment.ticket_id
                  WHERE moved_assignment.rotation_id = ?3
                    AND moved_assignment.released_at = ?2
                    AND moved_ticket.ticket_group_id = ?4`,
              ).bind(rotation.id, now, group.rotation_id, group.ticket_group_id),
              this.env.DB.prepare(
                `UPDATE rotations SET status = 'CANCELED', completed_at = ?1,
                        version = version + 1, updated_at = ?1
                  WHERE id = ?2 AND status = 'DRAFT'
                    AND NOT EXISTS (
                      SELECT 1 FROM rotation_tickets remaining_assignment
                       WHERE remaining_assignment.rotation_id = rotations.id
                         AND remaining_assignment.released_at IS NULL
                    )`,
              ).bind(now, group.rotation_id),
              this.env.DB.prepare(
                `UPDATE flight_groups SET status = 'CANCELED', version = version + 1, updated_at = ?1
                  WHERE id = (
                    SELECT flight_group_id FROM rotations
                     WHERE id = ?2 AND status = 'CANCELED'
                  )`,
              ).bind(now, group.rotation_id),
            ])
        : [];
    const recurringProgressStatements: D1PreparedStatement[] = [];
    if (command.type === "COMPLETE_TURNAROUND") {
      const recurringRules = await this.env.DB.prepare(
        `SELECT rule.id, rule.version, rule.scope_type, rule.scope_id, rule.operation_kind,
                rule.trigger_metric, rule.interval_value, rule.progress_value,
                rule.minimum_duration_minutes, rule.typical_duration_minutes,
                rule.maximum_duration_minutes, rule.sequence_number,
                (SELECT plan.id FROM planned_operational_constraints plan
                  WHERE plan.recurring_rule_id = rule.id
                    AND plan.status IN ('PLANNED', 'ACTIVE')
                  ORDER BY plan.recurrence_sequence DESC LIMIT 1) AS open_plan_id
           FROM recurring_operational_rules rule
          WHERE rule.operation_day_id = ?1 AND rule.status = 'ACTIVE'
            AND (
              (rule.scope_type = 'AIRCRAFT' AND rule.scope_id = ?2)
              OR (rule.scope_type = 'PILOT' AND rule.scope_id = ?3)
            )
          ORDER BY rule.scope_type, rule.scope_id, rule.operation_kind, rule.id`,
      )
        .bind(command.eventId, selectedAircraftId, selectedPilotId)
        .all<{
          id: string;
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
          sequence_number: number;
          open_plan_id: string | null;
        }>();
      const operatingMinutes = rotation.called_at
        ? Math.max(0, Math.round((Date.parse(now) - Date.parse(rotation.called_at)) / 60_000))
        : 0;
      const withinOperations =
        !current.operations_end_at || Date.parse(now) < Date.parse(current.operations_end_at);
      for (const rule of recurringRules.results) {
        const increment = rule.trigger_metric === "COMPLETED_ROTATIONS" ? 1 : operatingMinutes;
        const progressValue = rule.progress_value + increment;
        const becomesDue =
          withinOperations && progressValue >= rule.interval_value && rule.open_plan_id === null;
        const nextSequence = rule.sequence_number + (becomesDue ? 1 : 0);
        recurringProgressStatements.push(
          this.env.DB.prepare(
            `UPDATE recurring_operational_rules
                SET progress_value = ?1, sequence_number = ?2, version = version + 1,
                    updated_at = ?3
              WHERE id = ?4 AND operation_day_id = ?5 AND version = ?6
                AND status = 'ACTIVE'`,
          ).bind(progressValue, nextSequence, now, rule.id, command.eventId, rule.version),
        );
        if (!becomesDue) continue;
        const occurrenceId = crypto.randomUUID();
        recurringProgressStatements.push(
          this.env.DB.prepare(
            `INSERT INTO planned_operational_constraints
              (id, operation_day_id, scope_type, scope_id, constraint_kind, start_mode,
               earliest_start_at, latest_start_at, after_rotation_id, effect_mode,
               duration_multiplier_percent, minimum_duration_minutes, typical_duration_minutes,
               maximum_duration_minutes, status, reason, public_note, version,
               created_by_device_id, created_at, updated_at, recurring_rule_id, recurrence_sequence)
             VALUES (?1, ?2, ?3, ?4, ?5, 'AFTER_CURRENT_ROTATION', NULL, NULL, ?6,
                     'BLOCKING', NULL, ?7, ?8, ?9, 'PLANNED', ?10, '', 0, ?11, ?12, ?12, ?13, ?14)`,
          ).bind(
            occurrenceId,
            command.eventId,
            rule.scope_type,
            rule.scope_id,
            rule.operation_kind,
            rotation.id,
            rule.minimum_duration_minutes,
            rule.typical_duration_minutes,
            rule.maximum_duration_minutes,
            "Wiederkehrende Regel nach bestätigtem Umlauf fällig.",
            command.deviceId,
            now,
            rule.id,
            nextSequence,
          ),
          this.env.DB.prepare(
            `INSERT INTO operational_events
              (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
               aggregate_id, aggregate_version, payload_json)
             VALUES (?1, ?2, 'RECURRING_OPERATION_DUE', ?3, ?4, 'OPERATIONAL_RULE', ?5, ?6, ?7)`,
          ).bind(
            crypto.randomUUID(),
            command.eventId,
            now,
            command.deviceId,
            rule.id,
            rule.version + 1,
            JSON.stringify({
              occurrenceId,
              recurrenceSequence: nextSequence,
              afterRotationId: rotation.id,
              progressValue,
              intervalValue: rule.interval_value,
              triggerMetric: rule.trigger_metric,
            }),
          ),
        );
      }
    }
    const manualOverrideLeaseStatements = manualOverrideLeases.flatMap((overriddenLease) => {
      const overridePayload = {
        action: "INVALIDATED",
        reason: "MANUAL_OVERRIDE",
        leaseId: overriddenLease.id,
        aircraftId: overriddenLease.aircraft_id,
        batchId: overriddenLease.dispatch_batch_id,
        overridingCommandId: command.commandId,
        queueDeviationReason: manualOverrideReason,
      };
      return [
        this.env.DB.prepare(
          `UPDATE dispatch_recommendation_leases
              SET status = 'INVALIDATED', invalidated_at = ?1, version = version + 1
            WHERE id = ?2 AND operation_day_id = ?3 AND status = 'ACTIVE'
              AND version = ?4 AND expires_at > ?1`,
        ).bind(now, overriddenLease.id, command.eventId, overriddenLease.version),
        this.env.DB.prepare(
          `INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
             aggregate_id, aggregate_version, payload_json)
           VALUES (?1, ?2, 'DISPATCH_RECOMMENDATION_LEASE_INVALIDATED', ?3, ?4,
                   'DISPATCH_LEASE', ?5, ?6, ?7)`,
        ).bind(
          crypto.randomUUID(),
          command.eventId,
          now,
          command.deviceId,
          overriddenLease.id,
          overriddenLease.version + 1,
          JSON.stringify(overridePayload),
        ),
        this.env.DB.prepare(
          `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
           VALUES (?1, ?2, 'DISPATCH_LEASE_CHANGED', ?3, ?4)`,
        ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(overridePayload), now),
      ];
    });
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      ...manualOverrideLeaseStatements,
      ...confirmedOvertakeStatements,
      ...groupMoveStatements,
      this.env.DB.prepare(
        `UPDATE rotations SET status = ?1, ${timestampColumn[command.type]} = ?2, aircraft_id = ?3,
                pilot_id = ?4,
                forecast_assumed_aircraft_id =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN NULL ELSE forecast_assumed_aircraft_id END,
                turnaround_product_id =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?6 ELSE turnaround_product_id END,
                turnaround_aircraft_id =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?7 ELSE turnaround_aircraft_id END,
                turnaround_boarding_minutes =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?8 ELSE turnaround_boarding_minutes END,
                turnaround_deboarding_minutes =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?9 ELSE turnaround_deboarding_minutes END,
                turnaround_buffer_minutes =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?10 ELSE turnaround_buffer_minutes END,
                turnaround_boarding_source =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?11 ELSE turnaround_boarding_source END,
                turnaround_deboarding_source =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?12 ELSE turnaround_deboarding_source END,
                turnaround_buffer_source =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?13 ELSE turnaround_buffer_source END,
                version = version + 1, updated_at = ?2
          WHERE id = ?14 AND version = ?15`,
      ).bind(
        nextState,
        now,
        selectedAircraftId,
        selectedPilotId,
        command.type,
        confirmedTurnaroundProductId,
        selectedAircraftId,
        confirmedTurnaroundProfile?.boarding.valueMinutes ?? null,
        confirmedTurnaroundProfile?.deboarding.valueMinutes ?? null,
        confirmedTurnaroundProfile?.buffer.valueMinutes ?? null,
        confirmedTurnaroundProfile
          ? `${confirmedTurnaroundProfile.boarding.sourceLevel}:${confirmedTurnaroundProfile.boarding.sourceId}`
          : null,
        confirmedTurnaroundProfile
          ? `${confirmedTurnaroundProfile.deboarding.sourceLevel}:${confirmedTurnaroundProfile.deboarding.sourceId}`
          : null,
        confirmedTurnaroundProfile
          ? `${confirmedTurnaroundProfile.buffer.sourceLevel}:${confirmedTurnaroundProfile.buffer.sourceId}`
          : null,
        rotation.id,
        rotation.version,
      ),
      this.env.DB.prepare(
        "UPDATE flight_groups SET status = ?1, version = version + 1, updated_at = ?2 WHERE id = (SELECT flight_group_id FROM rotations WHERE id = ?3)",
      ).bind(nextState, now, rotation.id),
      this.env.DB.prepare(
        `UPDATE aircraft SET operational_state = ?1,
                operational_state_changed_at = CASE
                  WHEN operational_state <> ?1 THEN ?2 ELSE operational_state_changed_at END,
                version = version + 1, updated_at = ?2,
                rotations_since_refuel = rotations_since_refuel + ?4 WHERE id = ?3`,
      ).bind(
        aircraftState,
        now,
        selectedAircraftId,
        command.type === "COMPLETE_TURNAROUND" ? 1 : 0,
      ),
      ...recurringProgressStatements,
      this.env.DB.prepare(
        `UPDATE tickets SET status = CASE
            WHEN ?1 = 'CALL_NEXT' THEN 'BOARDING'
            WHEN ?1 = 'CANCEL_ROTATION' THEN 'QUEUED'
            ELSE ?2
          END
          WHERE id IN (
            SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?3 AND released_at IS NULL
          )`,
      ).bind(command.type, nextState, rotation.id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET status = CASE
            WHEN ticket_groups.status IN ('MISSING', 'CLARIFICATION') THEN ticket_groups.status
            WHEN EXISTS (
              SELECT 1 FROM tickets segment_ticket
              JOIN rotation_tickets segment_assignment
                ON segment_assignment.ticket_id = segment_ticket.id
               AND segment_assignment.released_at IS NULL
              JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
              WHERE segment_ticket.ticket_group_id = ticket_groups.id
                AND segment_rotation.status = 'DRAFT'
            ) THEN CASE WHEN EXISTS (
              SELECT 1 FROM tickets pending_ticket
              JOIN rotation_tickets pending_assignment
                ON pending_assignment.ticket_id = pending_ticket.id
               AND pending_assignment.released_at IS NULL
              JOIN rotations pending_rotation ON pending_rotation.id = pending_assignment.rotation_id
              WHERE pending_ticket.ticket_group_id = ticket_groups.id
                AND pending_rotation.status = 'DRAFT'
                AND pending_ticket.attendance_status = 'CHECKED_IN'
            ) THEN 'PRESENT' ELSE 'QUEUED' END
            WHEN EXISTS (
              SELECT 1 FROM tickets segment_ticket
              JOIN rotation_tickets segment_assignment
                ON segment_assignment.ticket_id = segment_ticket.id
               AND segment_assignment.released_at IS NULL
              JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
              WHERE segment_ticket.ticket_group_id = ticket_groups.id
                AND segment_rotation.status = 'CALLED'
            ) THEN 'BOARDING'
            WHEN EXISTS (
              SELECT 1 FROM tickets segment_ticket
              JOIN rotation_tickets segment_assignment
                ON segment_assignment.ticket_id = segment_ticket.id
               AND segment_assignment.released_at IS NULL
              JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
              WHERE segment_ticket.ticket_group_id = ticket_groups.id
                AND segment_rotation.status = 'IN_FLIGHT'
            ) THEN 'IN_FLIGHT'
            WHEN EXISTS (
              SELECT 1 FROM tickets segment_ticket
              JOIN rotation_tickets segment_assignment
                ON segment_assignment.ticket_id = segment_ticket.id
               AND segment_assignment.released_at IS NULL
              JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
              WHERE segment_ticket.ticket_group_id = ticket_groups.id
                AND segment_rotation.status = 'LANDED'
            ) THEN 'LANDED'
            WHEN EXISTS (
              SELECT 1 FROM tickets segment_ticket
              JOIN rotation_tickets segment_assignment
                ON segment_assignment.ticket_id = segment_ticket.id
               AND segment_assignment.released_at IS NULL
              JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
              WHERE segment_ticket.ticket_group_id = ticket_groups.id
                AND segment_rotation.status = 'COMPLETED'
            ) THEN 'COMPLETED'
            ELSE 'CANCELED'
          END,
          version = version + 1
          WHERE id IN (
            SELECT DISTINCT t.ticket_group_id
              FROM tickets t
              JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
             WHERE rt.rotation_id = ?1
           )`,
      ).bind(rotation.id),
      ...this.ticketGroupRecallClosureStatements({
        recalls: recallClosures,
        eventId: command.eventId,
        reason: "BOARDING",
        deviceId: command.deviceId,
        now,
        event: result.event,
      }),
      this.env.DB.prepare(`INSERT INTO operational_events (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type, aggregate_id, aggregate_version, payload_json)
        VALUES (?1, ?2, ?3, ?4, ?5, 'ROTATION', ?6, ?7, ?8)`).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType[command.type],
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({
          from: rotation.status,
          to: nextState,
          aircraftId: selectedAircraftId,
          pilotId: selectedPilotId,
          queueDeviationReason:
            command.type === "CALL_NEXT"
              ? (command.payload.queueDeviationReason ??
                (acceptedDispatchRecommendation ? "CAPACITY_OPTIMIZED_DISPATCH" : null))
              : null,
          dispatchRecommendation:
            command.type === "CALL_NEXT" && acceptedDispatchRecommendation
              ? command.payload.dispatchRecommendation
              : null,
          dispatchRecommendationLeaseId:
            command.type === "CALL_NEXT" ? (acceptedDispatchRecommendationLease?.id ?? null) : null,
          skippedTicketGroupIds: command.type === "CALL_NEXT" ? skippedEarlierTicketGroupIds : [],
          confirmedOvertakes: command.type === "CALL_NEXT" ? confirmedOvertakeIncrements : [],
        }),
      ),
      ...(acceptedDispatchRecommendationLease
        ? [
            this.env.DB.prepare(
              `UPDATE dispatch_recommendation_leases
                  SET status = 'CONSUMED', consumed_at = ?1, version = version + 1
                WHERE id = ?2 AND operation_day_id = ?3 AND status = 'ACTIVE'
                  AND operator_account_id = ?4 AND device_id = ?5 AND aircraft_id = ?6
                  AND expires_at > ?1`,
            ).bind(
              now,
              acceptedDispatchRecommendationLease.id,
              command.eventId,
              operatorAccountId,
              command.deviceId,
              selectedAircraftId,
            ),
            this.env.DB.prepare(
              `INSERT INTO operational_events
                (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
                 aggregate_id, aggregate_version, payload_json)
               VALUES (?1, ?2, 'DISPATCH_RECOMMENDATION_LEASE_CONSUMED', ?3, ?4,
                       'DISPATCH_LEASE', ?5, ?6, ?7)`,
            ).bind(
              crypto.randomUUID(),
              command.eventId,
              now,
              command.deviceId,
              acceptedDispatchRecommendationLease.id,
              acceptedDispatchRecommendationLease.version + 1,
              JSON.stringify({
                aircraftId: selectedAircraftId,
                rotationId: rotation.id,
                dispatchBatchId: acceptedDispatchRecommendationLease.dispatch_batch_id,
              }),
            ),
          ]
        : []),
      this.env.DB.prepare(`INSERT INTO idempotency_receipts (command_id, operation_day_id, device_id, command_type, received_at, response_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
        command.commandId,
        command.eventId,
        command.deviceId,
        command.type,
        now,
        JSON.stringify(result),
      ),
      this.env.DB.prepare(
        "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), now),
    ]);
    const pushEvent = {
      CALL_NEXT: "BOARDING_STARTED",
      MARK_OFF_BLOCK: "ROTATION_STARTED",
      MARK_ON_BLOCK: "ROTATION_LANDED",
      COMPLETE_TURNAROUND: "ROTATION_COMPLETED",
      CANCEL_ROTATION: null,
    } as const;
    const notification = pushEvent[command.type];
    if (notification) {
      this.waitUntil(sendRotationPushNotifications(this.env, rotation.id, notification));
    }
    this.broadcastResult(result);
    return json(result);
  }
}
