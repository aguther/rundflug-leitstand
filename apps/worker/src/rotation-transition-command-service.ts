import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import type { ConfirmedOvertakeIncrement } from "@rundflug/domain";
import { prepareTransitionContext, resolveTransitionExecution } from "./rotation-call-preparation";
import {
  dispatchQueueDeviationReason,
  rotationTransitionJson as json,
} from "./rotation-transition-presentation";
import {
  buildRecurringProgressStatements,
  calculateTransitionOvertakes,
} from "./rotation-transition-progress";
import { rowToSnapshot } from "./snapshot";
import type {
  StoredTicketGroupRecall,
  TicketGroupRecallClosureInput,
} from "./ticket-group-recall-persistence-service";
import type { Env, StoredEventRow } from "./types";
import { sendRotationPushNotifications } from "./web-push";

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
    const transitionContext = await prepareTransitionContext({
      env: this.env,
      command,
      current,
      operatorAccountId,
    });
    if (!transitionContext.prepared) return transitionContext.response;
    const { rotation, call: callPreparation } = transitionContext;
    const selectedGroups = callPreparation?.selectedGroups ?? [];
    const skippedEarlierTicketGroupIds = callPreparation?.skippedEarlierTicketGroupIds ?? [];
    const acceptedDispatchRecommendation = callPreparation?.acceptedDispatchRecommendation ?? false;
    const acceptedDispatchRecommendationLease =
      callPreparation?.acceptedDispatchRecommendationLease ?? null;
    const manualOverrideLeases = callPreparation?.manualOverrideLeases ?? [];
    const manualOverrideReason = callPreparation?.manualOverrideReason ?? null;
    let confirmedOvertakeIncrements: ConfirmedOvertakeIncrement[] = [];
    const confirmedTurnaroundProductId = callPreparation?.confirmedTurnaroundProductId ?? null;
    const confirmedTurnaroundProfile = callPreparation?.confirmedTurnaroundProfile ?? null;
    const timestampColumn = {
      CALL_NEXT: "called_at",
      MARK_OFF_BLOCK: "departed_at",
      MARK_ON_BLOCK: "landed_at",
      COMPLETE_TURNAROUND: "completed_at",
      CANCEL_ROTATION: "completed_at",
    } as const;
    const transitionExecution = resolveTransitionExecution(command, rotation);
    if (!transitionExecution.resolved) return transitionExecution.response;
    const { nextState, selectedAircraftId, selectedPilotId, aircraftState } = transitionExecution;
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
    confirmedOvertakeIncrements = await calculateTransitionOvertakes({
      command,
      selectedGroups,
      loadEligibleDraftMembers: this.loadEligibleDraftMembers,
    });
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
    const recurringProgressStatements = await buildRecurringProgressStatements({
      env: this.env,
      command,
      current,
      rotation,
      selectedAircraftId,
      selectedPilotId,
      now,
    });
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
    const queueDeviationReason = dispatchQueueDeviationReason(
      command,
      acceptedDispatchRecommendation,
    );
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
          queueDeviationReason,
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
    scheduleRotationPush(this.waitUntil, this.env, rotation.id, command.type);
    this.broadcastResult(result);
    return json(result);
  }
}

function scheduleRotationPush(
  waitUntil: (promise: Promise<unknown>) => void,
  env: Env,
  rotationId: string,
  commandType: RotationTransitionCommand["type"],
): void {
  const pushEvent = {
    CALL_NEXT: "BOARDING_STARTED",
    MARK_OFF_BLOCK: "ROTATION_STARTED",
    MARK_ON_BLOCK: "ROTATION_LANDED",
    COMPLETE_TURNAROUND: "ROTATION_COMPLETED",
    CANCEL_ROTATION: null,
  } as const;
  const notification = pushEvent[commandType];
  if (notification) waitUntil(sendRotationPushNotifications(env, rotationId, notification));
}
