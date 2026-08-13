import {
  assertProductPureSelection,
  DomainRuleError,
  compareTechnicalStrings as order,
  type RotationState,
  resolveTurnaroundProfile,
  transitionRotation,
} from "@rundflug/domain";
import { dispatchSegmentOrderSql } from "./dispatch-ordering-sql";
import type { StoredDispatchRecommendationLease } from "./dispatch-recommendation-lease-service";
import type { RotationTransitionCommand } from "./rotation-transition-command-service";
import { rotationTransitionJson as json } from "./rotation-transition-presentation";
import type { Env, StoredEventRow } from "./types";

export type StoredTransitionRotation = {
  id: string;
  status: RotationState;
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
};

export type SelectedRotationGroup = {
  ticket_group_id: string;
  rotation_id: string;
  resource_group_id: string;
  product_id: string;
  queue_sequence: number;
  ticket_count: number;
};

type CallNextCommand = Extract<RotationTransitionCommand, { type: "CALL_NEXT" }>;

export type RotationCallPreparation = {
  selectedGroups: SelectedRotationGroup[];
  skippedEarlierTicketGroupIds: string[];
  acceptedDispatchRecommendation: boolean;
  acceptedDispatchRecommendationLease: StoredDispatchRecommendationLease | null;
  manualOverrideLeases: StoredDispatchRecommendationLease[];
  manualOverrideReason: string | null;
  confirmedTurnaroundProductId: string;
  confirmedTurnaroundProfile: ReturnType<typeof resolveTurnaroundProfile>;
};

export class RotationTransitionResponseError extends Error {
  constructor(readonly response: Response) {
    super("Rotation transition rejected");
  }
}

export async function loadTransitionRotation(
  env: Env,
  command: RotationTransitionCommand,
): Promise<StoredTransitionRotation> {
  const primaryAssignment =
    command.type === "CALL_NEXT"
      ? await env.DB.prepare(
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
  if (!rotationId) reject("ROTATION_NOT_FOUND", "Keine ausgewählte Gruppe gefunden.", 404);
  const rotation = await env.DB.prepare(
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
    .first<StoredTransitionRotation>();
  if (!rotation) reject("ROTATION_NOT_FOUND", "Umlauf nicht gefunden.", 404);
  return rotation;
}

export function resolveTransitionState(
  command: RotationTransitionCommand,
  currentState: RotationState,
): RotationState {
  const target = {
    CALL_NEXT: "CALLED",
    MARK_OFF_BLOCK: "IN_FLIGHT",
    MARK_ON_BLOCK: "LANDED",
    COMPLETE_TURNAROUND: "COMPLETED",
    CANCEL_ROTATION: "CANCELED",
  } as const;
  try {
    return transitionRotation(currentState, target[command.type]);
  } catch (reason: unknown) {
    if (!(reason instanceof DomainRuleError)) throw reason;
    reject(reason.code, reason.message, 409);
  }
}

export function resolveTransitionAssignments(
  command: RotationTransitionCommand,
  rotation: StoredTransitionRotation,
): {
  selectedAircraftId: string;
  selectedPilotId: string;
  aircraftState: string;
} {
  const selectedAircraftId =
    command.type === "CALL_NEXT" ? command.payload.aircraftId : rotation.aircraft_id;
  if (!selectedAircraftId) {
    reject("AIRCRAFT_ASSIGNMENT_REQUIRED", "Flugzeugzuordnung fehlt.", 409);
  }
  const selectedPilotId =
    command.type === "CALL_NEXT" ? command.payload.pilotId : rotation.pilot_id;
  if (!selectedPilotId) reject("PILOT_ASSIGNMENT_REQUIRED", "Pilotenzuordnung fehlt.", 409);
  const aircraftState =
    command.type === "COMPLETE_TURNAROUND"
      ? command.payload.nextAircraftState
      : {
          CALL_NEXT: "BOARDING",
          MARK_OFF_BLOCK: "IN_FLIGHT",
          MARK_ON_BLOCK: "LANDED",
          CANCEL_ROTATION: "AVAILABLE",
        }[command.type];
  return { selectedAircraftId, selectedPilotId, aircraftState };
}

export function resolveTransitionExecution(
  command: RotationTransitionCommand,
  rotation: StoredTransitionRotation,
):
  | {
      resolved: true;
      nextState: RotationState;
      selectedAircraftId: string;
      selectedPilotId: string;
      aircraftState: string;
    }
  | { resolved: false; response: Response } {
  try {
    return {
      resolved: true,
      nextState: resolveTransitionState(command, rotation.status),
      ...resolveTransitionAssignments(command, rotation),
    };
  } catch (reason) {
    if (reason instanceof RotationTransitionResponseError) {
      return { resolved: false, response: reason.response };
    }
    throw reason;
  }
}

export async function prepareTransitionContext(input: {
  env: Env;
  command: RotationTransitionCommand;
  current: StoredEventRow;
  operatorAccountId: string | null;
}): Promise<
  | { prepared: true; rotation: StoredTransitionRotation; call: RotationCallPreparation | null }
  | { prepared: false; response: Response }
> {
  try {
    const rotation = await loadTransitionRotation(input.env, input.command);
    const call =
      input.command.type === "CALL_NEXT"
        ? await prepareRotationCall({
            ...input,
            command: input.command,
            rotation,
          })
        : null;
    return { prepared: true, rotation, call };
  } catch (reason) {
    if (reason instanceof RotationTransitionResponseError) {
      return { prepared: false, response: reason.response };
    }
    throw reason;
  }
}

export async function prepareRotationCall(input: {
  env: Env;
  command: CallNextCommand;
  current: StoredEventRow;
  operatorAccountId: string | null;
  rotation: StoredTransitionRotation;
}): Promise<RotationCallPreparation> {
  assertResourceGroupActive(input.rotation);
  const distinctGroupIds = distinctSelectedGroupIds(input.command);
  const selectedGroups = await loadSelectedGroups(input.env, input.command, distinctGroupIds);
  const recommendation = await resolveRecommendation({
    ...input,
    distinctGroupIds,
    selectedGroups,
  });
  const turnaround = await resolveTurnaround(input, selectedGroups);
  const skippedEarlierTicketGroupIds = await loadSkippedEarlierGroups({
    ...input,
    selectedGroups,
    selectedProductId: turnaround.productId,
    acceptedDispatchRecommendation: recommendation.accepted,
  });
  await validateAircraftAndPilot(input, selectedGroups);
  return {
    selectedGroups,
    skippedEarlierTicketGroupIds,
    acceptedDispatchRecommendation: recommendation.accepted,
    acceptedDispatchRecommendationLease: recommendation.lease,
    manualOverrideLeases: recommendation.manualOverrideLeases,
    manualOverrideReason: recommendation.manualOverrideReason,
    confirmedTurnaroundProductId: turnaround.productId,
    confirmedTurnaroundProfile: turnaround.profile,
  };
}

function assertResourceGroupActive(rotation: StoredTransitionRotation): void {
  if (rotation.resource_group_status === "ACTIVE") return;
  reject("RESOURCE_GROUP_NOT_ACTIVE", "Ressourcengruppe ist für neue Aufrufe nicht aktiv.", 409);
}

function distinctSelectedGroupIds(command: CallNextCommand): string[] {
  const distinctGroupIds = [...new Set(command.payload.ticketGroupIds)];
  if (distinctGroupIds.length === command.payload.ticketGroupIds.length) return distinctGroupIds;
  reject("DUPLICATE_TICKET_GROUP", "Eine Gruppe wurde mehrfach gewählt.", 400);
}

async function loadSelectedGroups(
  env: Env,
  command: CallNextCommand,
  distinctGroupIds: readonly string[],
): Promise<SelectedRotationGroup[]> {
  const placeholders = distinctGroupIds.map((_, index) => `?${index + 2}`).join(", ");
  const groupResult = await env.DB.prepare(
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
    .all<SelectedRotationGroup>();
  const selectedGroups = groupResult.results;
  if (selectedGroups.length !== distinctGroupIds.length) {
    reject(
      "TICKET_GROUP_NOT_AVAILABLE",
      "Mindestens eine Gruppe ist nicht mehr in der Warteschlange verfügbar.",
      409,
    );
  }
  if (new Set(selectedGroups.map((group) => group.resource_group_id)).size !== 1) {
    reject(
      "RESOURCE_GROUP_MISMATCH",
      "Ausgewählte Gruppen gehören nicht zur gleichen Ressourcengruppe.",
      409,
    );
  }
  return selectedGroups;
}

async function resolveRecommendation(input: {
  env: Env;
  command: CallNextCommand;
  current: StoredEventRow;
  operatorAccountId: string | null;
  rotation: StoredTransitionRotation;
  distinctGroupIds: readonly string[];
  selectedGroups: readonly SelectedRotationGroup[];
}): Promise<{
  accepted: boolean;
  lease: StoredDispatchRecommendationLease | null;
  manualOverrideLeases: StoredDispatchRecommendationLease[];
  manualOverrideReason: string | null;
}> {
  const leaseId = input.command.payload.dispatchRecommendationLeaseId;
  if (leaseId) {
    const lease = await validateRecommendationLease(input, leaseId);
    return {
      accepted: true,
      lease,
      manualOverrideLeases: [],
      manualOverrideReason: null,
    };
  }
  const accepted = validateCurrentRecommendation(input);
  const override = await loadManualOverride(input);
  return {
    accepted,
    lease: null,
    manualOverrideLeases: override.leases,
    manualOverrideReason: override.reason,
  };
}

async function validateRecommendationLease(
  input: {
    env: Env;
    command: CallNextCommand;
    operatorAccountId: string | null;
    distinctGroupIds: readonly string[];
    selectedGroups: readonly SelectedRotationGroup[];
  },
  leaseId: string,
): Promise<StoredDispatchRecommendationLease> {
  if (!input.operatorAccountId || !input.command.payload.dispatchRecommendation) {
    reject(
      "DISPATCH_RECOMMENDATION_LEASE_MISMATCH",
      "Die Vorschlagsreservierung gehört nicht zu dieser Bestätigung.",
      409,
    );
  }
  const lease = await input.env.DB.prepare(
    `SELECT id, operation_day_id, aircraft_id, operator_account_id, device_id,
            acquire_command_id, dispatch_plan_revision, dispatch_batch_id,
            dispatch_order, ticket_group_ids_json, occupied_seats, available_seats,
            decision_reasons_json, operation_day_version, member_rotation_ids_json,
            status, acquired_at, expires_at, version
       FROM dispatch_recommendation_leases
      WHERE id = ?1 AND operation_day_id = ?2`,
  )
    .bind(leaseId, input.command.eventId)
    .first<StoredDispatchRecommendationLease>();
  if (lease?.status !== "ACTIVE") {
    reject(
      "DISPATCH_RECOMMENDATION_LEASE_CONFLICT",
      "Die Vorschlagsreservierung ist nicht mehr aktiv.",
      409,
    );
  }
  if (Date.parse(lease.expires_at) <= Date.now()) {
    reject(
      "DISPATCH_RECOMMENDATION_LEASE_EXPIRED",
      "Die Vorschlagsreservierung ist abgelaufen. Bitte neu reservieren.",
      409,
    );
  }
  if (!recommendationLeaseMatches(input, lease)) {
    reject(
      "DISPATCH_RECOMMENDATION_LEASE_MISMATCH",
      "Die reservierte Belegung passt nicht mehr zum aktuellen Zustand. Bitte aktuellen Vorschlag laden.",
      409,
    );
  }
  return lease;
}

function recommendationLeaseMatches(
  input: {
    command: CallNextCommand;
    operatorAccountId: string | null;
    distinctGroupIds: readonly string[];
    selectedGroups: readonly SelectedRotationGroup[];
  },
  lease: StoredDispatchRecommendationLease,
): boolean {
  const recommendation = input.command.payload.dispatchRecommendation;
  if (!recommendation) return false;
  const leaseGroupIds = (JSON.parse(lease.ticket_group_ids_json) as string[]).sort(order);
  const leaseMemberRotationIds = (JSON.parse(lease.member_rotation_ids_json) as string[]).sort(
    order,
  );
  const selectedGroupIds = [...input.distinctGroupIds].sort(order);
  const selectedMemberRotationIds = [
    ...new Set(input.selectedGroups.map((group) => group.rotation_id)),
  ].sort(order);
  const selectedSeatCount = input.selectedGroups.reduce(
    (sum, group) => sum + Number(group.ticket_count),
    0,
  );
  return (
    lease.operator_account_id === input.operatorAccountId &&
    lease.device_id === input.command.deviceId &&
    lease.aircraft_id === input.command.payload.aircraftId &&
    lease.dispatch_plan_revision === recommendation.planRevision &&
    lease.dispatch_batch_id === recommendation.batchId &&
    sameIds(leaseGroupIds, selectedGroupIds) &&
    sameIds(leaseMemberRotationIds, selectedMemberRotationIds) &&
    lease.occupied_seats === selectedSeatCount
  );
}

function validateCurrentRecommendation(input: {
  command: CallNextCommand;
  current: StoredEventRow;
  rotation: StoredTransitionRotation;
  distinctGroupIds: readonly string[];
}): boolean {
  const recommendation = input.command.payload.dispatchRecommendation;
  if (!recommendation) return false;
  const selectedGroupIds = [...input.distinctGroupIds].sort(order);
  const currentRecommendedGroupIds = (
    JSON.parse(input.rotation.dispatch_group_ids_json) as string[]
  ).sort(order);
  const accepted =
    input.rotation.dispatch_operation_day_version === input.current.version &&
    input.rotation.dispatch_plan_revision === recommendation.planRevision &&
    input.rotation.dispatch_batch_id === recommendation.batchId &&
    input.rotation.forecast_assumed_aircraft_id === input.command.payload.aircraftId &&
    sameIds(selectedGroupIds, currentRecommendedGroupIds);
  if (accepted) return true;
  throw new RotationTransitionResponseError(
    json(
      {
        error: {
          code: "DISPATCH_PLAN_STALE",
          message:
            "Die Belegungsempfehlung wurde inzwischen neu berechnet. Bitte aktuellen Plan prüfen.",
          currentPlanRevision: input.rotation.dispatch_plan_revision,
          currentBatchId: input.rotation.dispatch_batch_id,
        },
      },
      { status: 409 },
    ),
  );
}

async function loadManualOverride(input: {
  env: Env;
  command: CallNextCommand;
  distinctGroupIds: readonly string[];
}): Promise<{ leases: StoredDispatchRecommendationLease[]; reason: string | null }> {
  const selectedGroupIdsJson = JSON.stringify(input.distinctGroupIds);
  const conflictingLeases = await input.env.DB.prepare(
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
    .bind(input.command.eventId, new Date().toISOString(), selectedGroupIdsJson)
    .all<StoredDispatchRecommendationLease>();
  const reason = input.command.payload.queueDeviationReason?.trim() ?? null;
  if (conflictingLeases.results.length > 0 && !reason) {
    reject(
      "QUEUE_DEVIATION_REASON_REQUIRED",
      "Für die manuelle Übersteuerung eines reservierten Vorschlags ist ein Grund erforderlich.",
      409,
    );
  }
  return { leases: conflictingLeases.results, reason };
}

async function resolveTurnaround(
  input: {
    env: Env;
    command: CallNextCommand;
    current: StoredEventRow;
    rotation: StoredTransitionRotation;
  },
  selectedGroups: readonly SelectedRotationGroup[],
): Promise<{
  productId: string;
  profile: ReturnType<typeof resolveTurnaroundProfile>;
}> {
  const productId = selectedProductId(selectedGroups);
  if (
    input.rotation.flight_group_product_id !== null &&
    input.rotation.flight_group_product_id !== productId
  ) {
    reject(
      "PRODUCT_MISMATCH",
      "Die Fluggruppe gehört nicht zum Produkt der ausgewählten Ticketgruppen.",
      409,
    );
  }
  const configuration = await input.env.DB.prepare(
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
    .bind(productId, input.command.eventId, input.command.payload.aircraftId)
    .first<{
      product_boarding: number | null;
      product_deboarding: number | null;
      product_buffer: number | null;
      aircraft_boarding: number | null;
      aircraft_deboarding: number | null;
      aircraft_buffer: number | null;
    }>();
  if (!configuration) reject("PRODUCT_NOT_FOUND", "Produkt nicht gefunden.", 404);
  return {
    productId,
    profile: resolveTurnaroundProfile({
      event: {
        sourceId: input.command.eventId,
        boardingMinutes: input.current.planned_boarding_minutes ?? 8,
        deboardingMinutes: input.current.planned_deboarding_minutes ?? 5,
        bufferMinutes: input.current.planned_buffer_minutes ?? 3,
      },
      product: {
        sourceId: productId,
        boardingMinutes: configuration.product_boarding,
        deboardingMinutes: configuration.product_deboarding,
        bufferMinutes: configuration.product_buffer,
      },
      aircraftProduct: {
        sourceId: `${input.command.payload.aircraftId}:${productId}`,
        boardingMinutes: configuration.aircraft_boarding,
        deboardingMinutes: configuration.aircraft_deboarding,
        bufferMinutes: configuration.aircraft_buffer,
      },
    }),
  };
}

function selectedProductId(selectedGroups: readonly SelectedRotationGroup[]): string {
  try {
    return assertProductPureSelection(selectedGroups.map((group) => group.product_id));
  } catch (reason: unknown) {
    if (!(reason instanceof DomainRuleError)) throw reason;
    reject(reason.code, reason.message, 409);
  }
}

async function loadSkippedEarlierGroups(input: {
  env: Env;
  command: CallNextCommand;
  selectedGroups: readonly SelectedRotationGroup[];
  selectedProductId: string;
  acceptedDispatchRecommendation: boolean;
}): Promise<string[]> {
  const earliestSelectedQueueSequence = Math.min(
    ...input.selectedGroups.map((group) => Number(group.queue_sequence)),
  );
  const skippedEarlierResult = await input.env.DB.prepare(
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
      input.command.eventId,
      input.selectedGroups[0]?.resource_group_id,
      input.selectedProductId,
      earliestSelectedQueueSequence,
    )
    .all<{ id: string }>();
  const skippedGroupIds = skippedEarlierResult.results.map((group) => group.id);
  if (
    skippedGroupIds.length > 0 &&
    !input.acceptedDispatchRecommendation &&
    !input.command.payload.queueDeviationReason?.trim()
  ) {
    reject(
      "QUEUE_DEVIATION_REASON_REQUIRED",
      "Für das Überspringen früherer Ticketgruppen eines anderen Produkts ist ein Grund erforderlich.",
      409,
    );
  }
  return skippedGroupIds;
}

async function validateAircraftAndPilot(
  input: { env: Env; command: CallNextCommand; rotation: StoredTransitionRotation },
  selectedGroups: readonly SelectedRotationGroup[],
): Promise<void> {
  const candidate = await input.env.DB.prepare(
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
    .bind(input.rotation.id, input.command.payload.aircraftId)
    .first<{
      id: string;
      passenger_seats: number;
      operational_state: string;
      current_pilot_id: string | null;
    }>();
  if (candidate?.operational_state !== "AVAILABLE") {
    reject("AIRCRAFT_NOT_AVAILABLE", "Flugzeug ist nicht verfügbar.", 409);
  }
  const selectedTicketCount = selectedGroups.reduce(
    (sum, group) => sum + Number(group.ticket_count),
    0,
  );
  if (selectedTicketCount > candidate.passenger_seats) {
    reject("AIRCRAFT_CAPACITY_EXCEEDED", "Flugzeugkapazität reicht nicht aus.", 409);
  }
  if (!candidate.current_pilot_id || candidate.current_pilot_id !== input.command.payload.pilotId) {
    reject(
      "AIRCRAFT_PILOT_ASSIGNMENT_MISMATCH",
      "Der bestätigte Pilotencode entspricht nicht der Pilotenzuweisung am Flugzeug.",
      409,
    );
  }
  const pilot = await input.env.DB.prepare(
    `SELECT p.id FROM pilots p
      WHERE p.id = ?1 AND p.operation_day_id = ?2 AND p.active = 1 AND p.paused = 0
        AND NOT EXISTS (
          SELECT 1 FROM rotations active_rotation
           WHERE active_rotation.operation_day_id = p.operation_day_id
             AND active_rotation.pilot_id = p.id
             AND active_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
        )`,
  )
    .bind(input.command.payload.pilotId, input.command.eventId)
    .first<{ id: string }>();
  if (!pilot) reject("PILOT_NOT_AVAILABLE", "Pilotencode ist nicht aktiv verfügbar.", 409);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function reject(code: string, message: string, status: number): never {
  throw new RotationTransitionResponseError(json({ error: { code, message } }, { status }));
}
