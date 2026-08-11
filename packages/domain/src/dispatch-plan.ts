import { compareTechnicalStrings } from "./technical-order";

export type DispatchCommitmentLevel = "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE";

export type DispatchDecisionReason =
  | "HARD_COMMITMENT"
  | "MUST_SERVE_MAX_WAIT"
  | "MUST_SERVE_MAX_OVERTAKES"
  | "PRODUCT_FAIRNESS"
  | "CAPACITY_OPTIMIZED"
  | "QUEUE_ORDER"
  | "PLAN_STABILITY"
  | "STANDBY_PRIORITY";

export type DispatchUnplannedReason =
  | "NO_FORECAST_CAPACITY"
  | "WAITING_FOR_FITTING_LANE"
  | "WAITING_FOR_PRODUCT_FAIRNESS"
  | "NOT_IN_NEAR_DISPATCH_BATCH"
  | "COMMITMENT_LOCKED"
  | "ATTENDANCE_MISSING"
  | "ATTENDANCE_CLARIFICATION"
  | "UNKNOWN_RESOURCE_RETURN";

export interface DispatchPlanningLimits {
  maximumGroupsPerResourceGroup: number;
  maximumGroupsPerProduct: number;
  maximumWaves: number;
  maximumCandidatesPerStep: number;
  beamWidth: number;
  maximumWaitMinutes: number;
  maximumOvertakes: number;
}

export const DEFAULT_DISPATCH_PLANNING_LIMITS: Readonly<DispatchPlanningLimits> = Object.freeze({
  maximumGroupsPerResourceGroup: 36,
  maximumGroupsPerProduct: 18,
  maximumWaves: 4,
  maximumCandidatesPerStep: 64,
  beamWidth: 24,
  maximumWaitMinutes: 90,
  maximumOvertakes: 3,
});

export interface DispatchGroupInput {
  /** Stable forecast member identifier. In production this is the draft rotation identifier. */
  id: string;
  /** Booking groups contained in this indivisible segment. */
  groupIds: readonly string[];
  /** Earlier draft segments that must be dispatched before this segment becomes eligible. */
  predecessorMemberIds?: readonly string[];
  size: number;
  productId: string;
  resourceGroupId: string;
  gateId: string;
  queueSequence: number;
  soldAt: string;
  waitingSince?: string;
  attendanceStatus: "WAITING" | "PRESENT" | "MISSING" | "CLARIFICATION";
  standby: boolean;
  publicStatus: DispatchCommitmentLevel;
  confirmedOvertakeCount?: number;
  productServiceDeficit?: number;
}

export interface DispatchProductDurationInput {
  productId: string;
  lowerMinutes: number;
  expectedMinutes: number;
  upperMinutes: number;
}

export interface DispatchLaneInput {
  id: string;
  aircraftId: string;
  pilotId: string | null;
  resourceGroupId: string;
  passengerSeats: number;
  availableLowerAt: string;
  availableExpectedAt: string;
  availableUpperAt: string;
  productDurations: readonly DispatchProductDurationInput[];
}

export interface DispatchBatch {
  id: string;
  resourceGroupId: string;
  productId: string;
  gateId: string;
  laneId: string;
  assumedAircraftId: string;
  assumedPilotId: string | null;
  memberIds: string[];
  groupIds: string[];
  occupiedSeats: number;
  availableSeats: number;
  dispatchOrder: number;
  wave: number;
  boardingWindowLowerAt: string;
  boardingWindowExpectedAt: string;
  boardingWindowUpperAt: string;
  predictedCompletionAt: string;
  commitmentLevel: DispatchCommitmentLevel;
  decisionReasons: DispatchDecisionReason[];
}

export interface DispatchGroupDecision {
  memberId: string;
  batchId: string;
  laneId: string;
  dispatchOrder: number;
  projectedOvertakeCount: number;
  decisionReasons: DispatchDecisionReason[];
}

export interface DispatchOvertakeMember {
  rotationId: string;
  queueSequence: number;
}

export interface ConfirmedOvertakeIncrement {
  rotationId: string;
  increment: number;
}

export function calculateConfirmedOvertakeIncrements(input: {
  selectedMembers: readonly DispatchOvertakeMember[];
  waitingMembers: readonly DispatchOvertakeMember[];
}): ConfirmedOvertakeIncrement[] {
  const selectedRotationIds = new Set(input.selectedMembers.map((member) => member.rotationId));
  return input.waitingMembers
    .filter((member) => !selectedRotationIds.has(member.rotationId))
    .map((member) => ({
      rotationId: member.rotationId,
      increment: input.selectedMembers.filter(
        (selected) => selected.queueSequence > member.queueSequence,
      ).length,
    }))
    .filter((entry) => entry.increment > 0)
    .sort((left, right) => left.rotationId.localeCompare(right.rotationId));
}

export interface DispatchUnplannedGroup {
  memberId: string;
  reason: DispatchUnplannedReason;
}

export interface DispatchPlan {
  planId: string;
  revision: string;
  batches: DispatchBatch[];
  groupDecisions: DispatchGroupDecision[];
  unplannedGroups: DispatchUnplannedGroup[];
  limits: DispatchPlanningLimits;
}

export interface DispatchLockedBatchInput {
  /** Stable batch identifier held by the active boarding lease. */
  id: string;
  resourceGroupId: string;
  productId: string;
  gateId: string;
  aircraftId: string;
  memberIds: readonly string[];
}

export interface DispatchPlanInput {
  now: string;
  groups: readonly DispatchGroupInput[];
  lanes: readonly DispatchLaneInput[];
  previousPlan?: DispatchPlan | null;
  /** Active boarding leases that must remain assigned to their reserved aircraft. */
  lockedBatches?: readonly DispatchLockedBatchInput[];
  limits?: Partial<DispatchPlanningLimits>;
}

interface NormalizedGroup extends DispatchGroupInput {
  waitMinutes: number;
  confirmedOvertakeCount: number;
  productServiceDeficit: number;
  mustServeForWait: boolean;
  mustServeForOvertakes: boolean;
}

interface NormalizedLane extends Omit<DispatchLaneInput, "productDurations"> {
  availableLowerMs: number;
  availableExpectedMs: number;
  availableUpperMs: number;
  wave: number;
  productDurations: ReadonlyMap<string, DispatchProductDurationInput>;
}

interface CandidateBatch {
  groups: NormalizedGroup[];
  productId: string;
  gateId: string;
  occupiedSeats: number;
  commitmentServed: number;
  mustServeCount: number;
  starvationScore: number;
  productFairnessScore: number;
  queueOvertakes: number;
  ageScore: number;
  stabilityMatches: number;
  prepareBreaks: number;
  reasons: DispatchDecisionReason[];
  stableKey: string;
}

interface PlannedBatchState {
  fixedBatchId?: string;
  laneId: string;
  wave: number;
  candidate: CandidateBatch;
  lowerMs: number;
  expectedMs: number;
  upperMs: number;
  completionMs: number;
}

interface SearchState {
  remaining: NormalizedGroup[];
  lanes: NormalizedLane[];
  batches: PlannedBatchState[];
  commitmentServed: number;
  calledDelayMs: number;
  mustServeCount: number;
  starvationScore: number;
  productFairnessScore: number;
  passengers: number;
  nearUtilizationScore: number;
  queueOvertakes: number;
  ageScore: number;
  stabilityMatches: number;
  prepareBreaks: number;
  stableKey: string;
}

const MINUTE_MS = 60_000;

function positiveInteger(value: number, fallback: number, maximum: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

function normalizedLimits(input?: Partial<DispatchPlanningLimits>): DispatchPlanningLimits {
  const defaults = DEFAULT_DISPATCH_PLANNING_LIMITS;
  return {
    maximumGroupsPerResourceGroup: positiveInteger(
      input?.maximumGroupsPerResourceGroup ?? defaults.maximumGroupsPerResourceGroup,
      defaults.maximumGroupsPerResourceGroup,
      100,
    ),
    maximumGroupsPerProduct: positiveInteger(
      input?.maximumGroupsPerProduct ?? defaults.maximumGroupsPerProduct,
      defaults.maximumGroupsPerProduct,
      50,
    ),
    maximumWaves: positiveInteger(
      input?.maximumWaves ?? defaults.maximumWaves,
      defaults.maximumWaves,
      12,
    ),
    maximumCandidatesPerStep: positiveInteger(
      input?.maximumCandidatesPerStep ?? defaults.maximumCandidatesPerStep,
      defaults.maximumCandidatesPerStep,
      256,
    ),
    beamWidth: positiveInteger(input?.beamWidth ?? defaults.beamWidth, defaults.beamWidth, 128),
    maximumWaitMinutes: positiveInteger(
      input?.maximumWaitMinutes ?? defaults.maximumWaitMinutes,
      defaults.maximumWaitMinutes,
      24 * 60,
    ),
    maximumOvertakes: positiveInteger(
      input?.maximumOvertakes ?? defaults.maximumOvertakes,
      defaults.maximumOvertakes,
      100,
    ),
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function commitmentRank(value: DispatchCommitmentLevel): number {
  if (value === "COME_TO_FLIGHT_LINE") return 2;
  if (value === "PREPARE") return 1;
  return 0;
}

function strongestCommitment(groups: readonly NormalizedGroup[]): DispatchCommitmentLevel {
  if (groups.some((group) => group.publicStatus === "COME_TO_FLIGHT_LINE")) {
    return "COME_TO_FLIGHT_LINE";
  }
  return groups.some((group) => group.publicStatus === "PREPARE") ? "PREPARE" : "WAITING";
}

function normalizeGroup(
  group: DispatchGroupInput,
  nowMs: number,
  limits: DispatchPlanningLimits,
): NormalizedGroup {
  if (
    !group.id ||
    group.groupIds.length === 0 ||
    new Set(group.groupIds).size !== group.groupIds.length ||
    new Set(group.predecessorMemberIds ?? []).size !== (group.predecessorMemberIds ?? []).length ||
    group.predecessorMemberIds?.includes(group.id)
  ) {
    throw new Error("Dispatch group identifiers and predecessors must be non-empty and unique.");
  }
  if (!Number.isInteger(group.size) || group.size <= 0) {
    throw new Error(`Dispatch group ${group.id} has an invalid size.`);
  }
  if (!Number.isInteger(group.queueSequence) || group.queueSequence <= 0) {
    throw new Error(`Dispatch group ${group.id} has an invalid queue sequence.`);
  }
  const waitingSinceMs = Date.parse(group.waitingSince ?? group.soldAt);
  if (!Number.isFinite(waitingSinceMs)) {
    throw new Error(`Dispatch group ${group.id} has an invalid waiting timestamp.`);
  }
  const waitMinutes = Math.max(0, (nowMs - waitingSinceMs) / MINUTE_MS);
  const confirmedOvertakeCount = Math.max(0, Math.floor(group.confirmedOvertakeCount ?? 0));
  return {
    ...group,
    groupIds: [...group.groupIds],
    predecessorMemberIds: [...(group.predecessorMemberIds ?? [])],
    waitMinutes,
    confirmedOvertakeCount,
    productServiceDeficit: Math.max(0, group.productServiceDeficit ?? 0),
    mustServeForWait: waitMinutes >= limits.maximumWaitMinutes,
    mustServeForOvertakes: confirmedOvertakeCount >= limits.maximumOvertakes,
  };
}

function groupOrder(left: NormalizedGroup, right: NormalizedGroup): number {
  return (
    commitmentRank(right.publicStatus) - commitmentRank(left.publicStatus) ||
    Number(right.mustServeForWait || right.mustServeForOvertakes) -
      Number(left.mustServeForWait || left.mustServeForOvertakes) ||
    right.productServiceDeficit - left.productServiceDeficit ||
    right.confirmedOvertakeCount - left.confirmedOvertakeCount ||
    right.waitMinutes - left.waitMinutes ||
    Number(right.standby) - Number(left.standby) ||
    left.queueSequence - right.queueSequence ||
    left.soldAt.localeCompare(right.soldAt) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Orders complete groups for deterministic projection beyond the bounded dispatch horizon.
 * The ordering intentionally reuses the dispatch fairness, waiting-age and overtake rules without
 * applying the dispatch candidate or beam-search limits.
 */
export function orderDispatchGroupsForProjection(input: {
  now: string;
  groups: readonly DispatchGroupInput[];
  limits?: Partial<DispatchPlanningLimits>;
}): DispatchGroupInput[] {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("Dispatch projection time is invalid.");
  const limits = normalizedLimits(input.limits);
  const seenIds = new Set<string>();
  return input.groups
    .map((group) => {
      if (seenIds.has(group.id)) throw new Error(`Dispatch group ${group.id} is duplicated.`);
      seenIds.add(group.id);
      return normalizeGroup(group, nowMs, limits);
    })
    .sort(groupOrder)
    .map(
      ({
        waitMinutes: _waitMinutes,
        mustServeForWait: _mustServeForWait,
        mustServeForOvertakes: _mustServeForOvertakes,
        ...group
      }) => group,
    );
}

function queueOrder(left: NormalizedGroup, right: NormalizedGroup): number {
  return (
    left.queueSequence - right.queueSequence ||
    left.soldAt.localeCompare(right.soldAt) ||
    left.id.localeCompare(right.id)
  );
}

function limitGroups(
  groups: readonly NormalizedGroup[],
  limits: DispatchPlanningLimits,
): NormalizedGroup[] {
  const ordered = [...groups].sort(queueOrder);
  const mandatory = new Set(
    ordered
      .filter(
        (group) =>
          group.publicStatus !== "WAITING" || group.mustServeForWait || group.mustServeForOvertakes,
      )
      .map((group) => group.id),
  );
  const perProduct = new Map<string, number>();
  const selected: NormalizedGroup[] = [];
  for (const group of ordered) {
    const productCount = perProduct.get(group.productId) ?? 0;
    if (
      !mandatory.has(group.id) &&
      (selected.length >= limits.maximumGroupsPerResourceGroup ||
        productCount >= limits.maximumGroupsPerProduct)
    ) {
      continue;
    }
    selected.push(group);
    perProduct.set(group.productId, productCount + 1);
  }
  return selected.sort(groupOrder);
}

function normalizeLane(lane: DispatchLaneInput): NormalizedLane {
  if (
    !lane.id ||
    !lane.aircraftId ||
    !Number.isInteger(lane.passengerSeats) ||
    lane.passengerSeats <= 0
  ) {
    throw new Error("Dispatch lane is missing a valid identifier, aircraft or capacity.");
  }
  const lower = Date.parse(lane.availableLowerAt);
  const expected = Date.parse(lane.availableExpectedAt);
  const upper = Date.parse(lane.availableUpperAt);
  if (![lower, expected, upper].every(Number.isFinite) || lower > expected || expected > upper) {
    throw new Error(`Dispatch lane ${lane.id} has an invalid availability window.`);
  }
  const productDurations = new Map<string, DispatchProductDurationInput>();
  for (const duration of lane.productDurations) {
    if (
      !duration.productId ||
      ![duration.lowerMinutes, duration.expectedMinutes, duration.upperMinutes].every(
        Number.isFinite,
      ) ||
      duration.lowerMinutes < 0 ||
      duration.lowerMinutes > duration.expectedMinutes ||
      duration.expectedMinutes > duration.upperMinutes
    ) {
      throw new Error(`Dispatch lane ${lane.id} has an invalid product duration.`);
    }
    productDurations.set(duration.productId, duration);
  }
  return {
    ...lane,
    productDurations,
    availableLowerMs: lower,
    availableExpectedMs: expected,
    availableUpperMs: upper,
    wave: 1,
  };
}

function previousSlotMembers(
  previousPlan: DispatchPlan | null | undefined,
): ReadonlyMap<string, Set<string>> {
  return new Map(
    (previousPlan?.batches ?? []).map((batch) => [
      `${batch.laneId}:${batch.wave}`,
      new Set(batch.memberIds),
    ]),
  );
}

function previousExpectedAtByMember(
  previousPlan: DispatchPlan | null | undefined,
  resourceGroupId: string,
): ReadonlyMap<string, number> {
  return new Map(
    (previousPlan?.batches ?? [])
      .filter((batch) => batch.resourceGroupId === resourceGroupId)
      .flatMap((batch) =>
        batch.memberIds.map(
          (memberId) => [memberId, Date.parse(batch.boardingWindowExpectedAt)] as const,
        ),
      ),
  );
}

function candidateReasons(
  groups: readonly NormalizedGroup[],
  queueOvertakes: number,
): DispatchDecisionReason[] {
  const reasons = new Set<DispatchDecisionReason>();
  if (groups.some((group) => group.publicStatus === "COME_TO_FLIGHT_LINE")) {
    reasons.add("HARD_COMMITMENT");
  }
  if (groups.some((group) => group.mustServeForWait)) reasons.add("MUST_SERVE_MAX_WAIT");
  if (groups.some((group) => group.mustServeForOvertakes)) {
    reasons.add("MUST_SERVE_MAX_OVERTAKES");
  }
  if (groups.some((group) => group.productServiceDeficit > 0)) reasons.add("PRODUCT_FAIRNESS");
  if (groups.length > 1 || queueOvertakes > 0) reasons.add("CAPACITY_OPTIMIZED");
  if (queueOvertakes === 0) reasons.add("QUEUE_ORDER");
  if (groups.some((group) => group.publicStatus !== "WAITING")) reasons.add("PLAN_STABILITY");
  if (groups.some((group) => group.standby)) reasons.add("STANDBY_PRIORITY");
  return [...reasons];
}

function buildCandidate(
  chosen: readonly NormalizedGroup[],
  remaining: readonly NormalizedGroup[],
  lane: NormalizedLane,
  previousMembers: ReadonlySet<string>,
): CandidateBatch {
  const chosenIds = new Set(chosen.map((group) => group.id));
  const queueOvertakes = chosen.reduce(
    (count, group) =>
      count +
      remaining.filter(
        (other) => !chosenIds.has(other.id) && other.queueSequence < group.queueSequence,
      ).length,
    0,
  );
  const stabilityMatches = chosen.filter((group) => previousMembers.has(group.id)).length;
  const prepareBreaks = remaining.filter(
    (group) =>
      previousMembers.has(group.id) && group.publicStatus !== "WAITING" && !chosenIds.has(group.id),
  ).length;
  const occupiedSeats = chosen.reduce((sum, group) => sum + group.size, 0);
  const stableKey = chosen
    .map((group) => group.id)
    .sort(compareTechnicalStrings)
    .join("+");
  return {
    groups: [...chosen].sort(queueOrder),
    productId: chosen[0]?.productId ?? "",
    gateId: chosen[0]?.gateId ?? "",
    occupiedSeats,
    commitmentServed: chosen.reduce(
      (sum, group) => sum + commitmentRank(group.publicStatus) * group.size,
      0,
    ),
    mustServeCount: chosen.filter((group) => group.mustServeForWait || group.mustServeForOvertakes)
      .length,
    starvationScore: chosen.reduce(
      (sum, group) =>
        sum +
        group.waitMinutes * group.size +
        group.confirmedOvertakeCount * 30 * group.size +
        commitmentRank(group.publicStatus) * 120 * group.size,
      0,
    ),
    productFairnessScore: chosen.reduce(
      (sum, group) => sum + group.productServiceDeficit * group.size,
      0,
    ),
    queueOvertakes,
    ageScore: chosen.reduce((sum, group) => sum + group.waitMinutes * group.size, 0),
    stabilityMatches,
    prepareBreaks,
    reasons: candidateReasons(chosen, queueOvertakes),
    stableKey: `${lane.id}:${lane.wave}:${stableKey}`,
  };
}

function compareCandidates(left: CandidateBatch, right: CandidateBatch): number {
  return (
    right.commitmentServed - left.commitmentServed ||
    right.mustServeCount - left.mustServeCount ||
    right.productFairnessScore - left.productFairnessScore ||
    right.starvationScore - left.starvationScore ||
    right.occupiedSeats - left.occupiedSeats ||
    left.queueOvertakes - right.queueOvertakes ||
    right.ageScore - left.ageScore ||
    left.prepareBreaks - right.prepareBreaks ||
    right.stabilityMatches - left.stabilityMatches ||
    left.stableKey.localeCompare(right.stableKey)
  );
}

function enumerateCandidates(
  remaining: readonly NormalizedGroup[],
  lane: NormalizedLane,
  limits: DispatchPlanningLimits,
  previousMembers: ReadonlySet<string>,
): CandidateBatch[] {
  const remainingIds = new Set(remaining.map((group) => group.id));
  const eligible = remaining.filter((group) =>
    (group.predecessorMemberIds ?? []).every((predecessorId) => !remainingIds.has(predecessorId)),
  );
  const byProductAndGate = new Map<string, NormalizedGroup[]>();
  for (const group of eligible) {
    if (group.size > lane.passengerSeats || !lane.productDurations.has(group.productId)) continue;
    const productGateKey = `${group.productId}\u0000${group.gateId}`;
    const values = byProductAndGate.get(productGateKey) ?? [];
    values.push(group);
    byProductAndGate.set(productGateKey, values);
  }
  const unique = new Map<string, CandidateBatch>();
  const generationLimit = limits.maximumCandidatesPerStep * 8;
  for (const [productGateKey, productGroups] of [...byProductAndGate.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const ordered = [...productGroups].sort(groupOrder).slice(0, limits.maximumGroupsPerProduct);
    const visit = (
      index: number,
      chosen: NormalizedGroup[],
      occupiedSeats: number,
      chosenGroupIds: ReadonlySet<string>,
    ): void => {
      if (unique.size >= generationLimit) return;
      if (index >= ordered.length) {
        if (chosen.length > 0) {
          const candidate = buildCandidate(chosen, remaining, lane, previousMembers);
          unique.set(`${productGateKey}:${candidate.stableKey}`, candidate);
        }
        return;
      }
      const group = ordered[index];
      const overlapsBookingGroup = group?.groupIds.some((groupId) => chosenGroupIds.has(groupId));
      if (group && !overlapsBookingGroup && occupiedSeats + group.size <= lane.passengerSeats) {
        visit(
          index + 1,
          [...chosen, group],
          occupiedSeats + group.size,
          new Set([...chosenGroupIds, ...group.groupIds]),
        );
      }
      visit(index + 1, chosen, occupiedSeats, chosenGroupIds);
    };
    visit(0, [], 0, new Set());
    for (const start of ordered) {
      const greedy = [start];
      let occupiedSeats = start.size;
      const greedyGroupIds = new Set(start.groupIds);
      for (const group of ordered) {
        if (
          group.id === start.id ||
          group.groupIds.some((groupId) => greedyGroupIds.has(groupId)) ||
          occupiedSeats + group.size > lane.passengerSeats
        ) {
          continue;
        }
        greedy.push(group);
        group.groupIds.forEach((groupId) => {
          greedyGroupIds.add(groupId);
        });
        occupiedSeats += group.size;
      }
      const candidate = buildCandidate(greedy, remaining, lane, previousMembers);
      unique.set(`${productGateKey}:${candidate.stableKey}`, candidate);
    }
  }
  return [...unique.values()].sort(compareCandidates).slice(0, limits.maximumCandidatesPerStep);
}

function laneOrder(left: NormalizedLane, right: NormalizedLane): number {
  return (
    left.availableExpectedMs - right.availableExpectedMs ||
    left.passengerSeats - right.passengerSeats ||
    left.availableLowerMs - right.availableLowerMs ||
    left.id.localeCompare(right.id)
  );
}

function compareStates(left: SearchState, right: SearchState): number {
  const leftHardUnserved = left.remaining.filter(
    (group) => group.publicStatus === "COME_TO_FLIGHT_LINE",
  ).length;
  const rightHardUnserved = right.remaining.filter(
    (group) => group.publicStatus === "COME_TO_FLIGHT_LINE",
  ).length;
  const leftMustServeUnserved = left.remaining.filter(
    (group) => group.mustServeForWait || group.mustServeForOvertakes,
  ).length;
  const rightMustServeUnserved = right.remaining.filter(
    (group) => group.mustServeForWait || group.mustServeForOvertakes,
  ).length;
  const leftMaximumWait = Math.max(0, ...left.remaining.map((group) => group.waitMinutes));
  const rightMaximumWait = Math.max(0, ...right.remaining.map((group) => group.waitMinutes));
  const leftMaximumOvertakeDebt = Math.max(
    0,
    ...left.remaining.map((group) => group.confirmedOvertakeCount),
  );
  const rightMaximumOvertakeDebt = Math.max(
    0,
    ...right.remaining.map((group) => group.confirmedOvertakeCount),
  );
  return (
    leftHardUnserved - rightHardUnserved ||
    left.calledDelayMs - right.calledDelayMs ||
    leftMustServeUnserved - rightMustServeUnserved ||
    right.productFairnessScore - left.productFairnessScore ||
    leftMaximumWait - rightMaximumWait ||
    leftMaximumOvertakeDebt - rightMaximumOvertakeDebt ||
    right.mustServeCount - left.mustServeCount ||
    right.starvationScore - left.starvationScore ||
    left.queueOvertakes - right.queueOvertakes ||
    right.passengers - left.passengers ||
    right.nearUtilizationScore - left.nearUtilizationScore ||
    right.ageScore - left.ageScore ||
    left.prepareBreaks - right.prepareBreaks ||
    right.commitmentServed - left.commitmentServed ||
    right.stabilityMatches - left.stabilityMatches ||
    left.stableKey.localeCompare(right.stableKey)
  );
}

function advanceState(
  state: SearchState,
  lane: NormalizedLane,
  candidate: CandidateBatch,
  duration: DispatchProductDurationInput,
  limits: DispatchPlanningLimits,
  previousExpectedAtByMember: ReadonlyMap<string, number>,
  fixedBatchId?: string,
): SearchState {
  const chosenIds = new Set(candidate.groups.map((group) => group.id));
  const nextLane: NormalizedLane = {
    ...lane,
    availableLowerMs: lane.availableLowerMs + duration.lowerMinutes * MINUTE_MS,
    availableExpectedMs: lane.availableExpectedMs + duration.expectedMinutes * MINUTE_MS,
    availableUpperMs: lane.availableUpperMs + duration.upperMinutes * MINUTE_MS,
    wave: lane.wave + 1,
  };
  const weight = limits.maximumWaves - lane.wave + 1;
  const calledDelayMs =
    fixedBatchId === undefined
      ? candidate.groups.reduce((penalty, group) => {
          if (group.publicStatus !== "COME_TO_FLIGHT_LINE") return penalty;
          const previousExpectedAt = previousExpectedAtByMember.get(group.id);
          return (
            penalty +
            (previousExpectedAt === undefined
              ? 0
              : Math.max(0, lane.availableExpectedMs - previousExpectedAt))
          );
        }, 0)
      : 0;
  return {
    remaining: state.remaining.filter((group) => !chosenIds.has(group.id)),
    lanes: state.lanes.map((entry) => (entry.id === lane.id ? nextLane : entry)),
    batches: [
      ...state.batches,
      {
        ...(fixedBatchId === undefined ? {} : { fixedBatchId }),
        laneId: lane.id,
        wave: lane.wave,
        candidate,
        lowerMs: lane.availableLowerMs,
        expectedMs: lane.availableExpectedMs,
        upperMs: lane.availableUpperMs,
        completionMs: lane.availableExpectedMs + duration.expectedMinutes * MINUTE_MS,
      },
    ],
    commitmentServed: state.commitmentServed + candidate.commitmentServed,
    calledDelayMs: state.calledDelayMs + calledDelayMs,
    mustServeCount: state.mustServeCount + candidate.mustServeCount,
    starvationScore: state.starvationScore + candidate.starvationScore,
    productFairnessScore: state.productFairnessScore + candidate.productFairnessScore,
    passengers: state.passengers + candidate.occupiedSeats,
    nearUtilizationScore:
      state.nearUtilizationScore +
      weight * (candidate.occupiedSeats / Math.max(1, lane.passengerSeats)),
    queueOvertakes: state.queueOvertakes + candidate.queueOvertakes,
    ageScore: state.ageScore + candidate.ageScore,
    stabilityMatches: state.stabilityMatches + candidate.stabilityMatches,
    prepareBreaks: state.prepareBreaks + candidate.prepareBreaks,
    stableKey: `${state.stableKey}|${candidate.stableKey}`,
  };
}

function planResourceGroup(input: {
  groups: readonly NormalizedGroup[];
  lanes: readonly NormalizedLane[];
  limits: DispatchPlanningLimits;
  previousSlots: ReadonlyMap<string, Set<string>>;
  previousExpectedAtByMember: ReadonlyMap<string, number>;
  lockedBatches: readonly DispatchLockedBatchInput[];
}): PlannedBatchState[] {
  if (input.groups.length === 0 || input.lanes.length === 0) return [];
  let initialState: SearchState = {
    remaining: [...input.groups],
    lanes: input.lanes.map((lane) => ({ ...lane })),
    batches: [],
    commitmentServed: 0,
    calledDelayMs: 0,
    mustServeCount: 0,
    starvationScore: 0,
    productFairnessScore: 0,
    passengers: 0,
    nearUtilizationScore: 0,
    queueOvertakes: 0,
    ageScore: 0,
    stabilityMatches: 0,
    prepareBreaks: 0,
    stableKey: "",
  };
  const lockedAircraftIds = new Set<string>();
  for (const lockedBatch of [...input.lockedBatches].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (lockedAircraftIds.has(lockedBatch.aircraftId)) {
      throw new Error(`Dispatch aircraft ${lockedBatch.aircraftId} has multiple active leases.`);
    }
    const lane = initialState.lanes.find(
      (entry) => entry.aircraftId === lockedBatch.aircraftId && entry.wave === 1,
    );
    if (!lane) {
      throw new Error(`Locked dispatch batch ${lockedBatch.id} has no available aircraft lane.`);
    }
    const memberIdSet = new Set(lockedBatch.memberIds);
    if (memberIdSet.size !== lockedBatch.memberIds.length || memberIdSet.size === 0) {
      throw new Error(`Locked dispatch batch ${lockedBatch.id} has invalid members.`);
    }
    const members = initialState.remaining.filter((group) => memberIdSet.has(group.id));
    if (members.length !== memberIdSet.size) {
      throw new Error(`Locked dispatch batch ${lockedBatch.id} references unavailable members.`);
    }
    if (
      members.some(
        (group) =>
          group.resourceGroupId !== lockedBatch.resourceGroupId ||
          group.productId !== lockedBatch.productId ||
          group.gateId !== lockedBatch.gateId,
      )
    ) {
      throw new Error(`Locked dispatch batch ${lockedBatch.id} is incompatible with its members.`);
    }
    const occupiedSeats = members.reduce((sum, group) => sum + group.size, 0);
    const duration = lane.productDurations.get(lockedBatch.productId);
    if (occupiedSeats > lane.passengerSeats || !duration) {
      throw new Error(`Locked dispatch batch ${lockedBatch.id} no longer fits its aircraft.`);
    }
    const previousMembers = new Set(lockedBatch.memberIds);
    const candidate = buildCandidate(members, initialState.remaining, lane, previousMembers);
    initialState = advanceState(
      initialState,
      lane,
      candidate,
      duration,
      input.limits,
      input.previousExpectedAtByMember,
      lockedBatch.id,
    );
    lockedAircraftIds.add(lockedBatch.aircraftId);
  }
  let beam: SearchState[] = [initialState];
  const maximumSteps = input.lanes.length * input.limits.maximumWaves;
  for (let step = 0; step < maximumSteps; step += 1) {
    const expanded: SearchState[] = [];
    for (const state of beam) {
      if (state.remaining.length === 0) {
        expanded.push(state);
        continue;
      }
      const lane = state.lanes
        .filter((entry) => entry.wave <= input.limits.maximumWaves)
        .sort(laneOrder)[0];
      if (!lane) {
        expanded.push(state);
        continue;
      }
      const previousMembers = input.previousSlots.get(`${lane.id}:${lane.wave}`) ?? new Set();
      const candidates = enumerateCandidates(state.remaining, lane, input.limits, previousMembers);
      if (candidates.length === 0) {
        expanded.push({
          ...state,
          lanes: state.lanes.map((entry) =>
            entry.id === lane.id ? { ...entry, wave: input.limits.maximumWaves + 1 } : entry,
          ),
          stableKey: `${state.stableKey}|${lane.id}:no-fit`,
        });
        continue;
      }
      for (const candidate of candidates) {
        const duration = lane.productDurations.get(candidate.productId);
        if (!duration) continue;
        expanded.push(
          advanceState(
            state,
            lane,
            candidate,
            duration,
            input.limits,
            input.previousExpectedAtByMember,
          ),
        );
      }
    }
    beam = expanded.sort(compareStates).slice(0, input.limits.beamWidth);
  }
  return (beam.sort(compareStates)[0]?.batches ?? []).sort(
    (left, right) =>
      left.expectedMs - right.expectedMs ||
      left.laneId.localeCompare(right.laneId) ||
      left.wave - right.wave,
  );
}

function unplannedReason(
  group: NormalizedGroup,
  lanes: readonly NormalizedLane[],
  planned: readonly PlannedBatchState[],
): DispatchUnplannedReason {
  if (lanes.length === 0) return "NO_FORECAST_CAPACITY";
  if (
    !lanes.some(
      (lane) => lane.passengerSeats >= group.size && lane.productDurations.has(group.productId),
    )
  ) {
    return "WAITING_FOR_FITTING_LANE";
  }
  if (group.publicStatus !== "WAITING") return "COMMITMENT_LOCKED";
  if (planned.some((batch) => batch.candidate.productId !== group.productId)) {
    return "WAITING_FOR_PRODUCT_FAIRNESS";
  }
  return "NOT_IN_NEAR_DISPATCH_BATCH";
}

export function createDispatchPlan(input: DispatchPlanInput): DispatchPlan {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("Dispatch planning time is invalid.");
  const limits = normalizedLimits(input.limits);
  const seenIds = new Set<string>();
  const normalizedGroups = input.groups.map((group) => {
    if (seenIds.has(group.id)) throw new Error(`Dispatch group ${group.id} is duplicated.`);
    seenIds.add(group.id);
    return normalizeGroup(group, nowMs, limits);
  });
  for (const group of normalizedGroups) {
    for (const predecessorId of group.predecessorMemberIds ?? []) {
      const predecessor = normalizedGroups.find((entry) => entry.id === predecessorId);
      if (!predecessor || predecessor.resourceGroupId !== group.resourceGroupId) {
        throw new Error(`Dispatch group ${group.id} has an invalid predecessor ${predecessorId}.`);
      }
    }
  }
  const normalizedLanes = input.lanes.map(normalizeLane);
  const previousSlots = previousSlotMembers(input.previousPlan);
  const lockedBatches = input.lockedBatches ?? [];
  const lockedBatchIds = new Set<string>();
  const lockedMemberIds = new Set<string>();
  for (const lockedBatch of lockedBatches) {
    if (lockedBatchIds.has(lockedBatch.id)) {
      throw new Error(`Locked dispatch batch ${lockedBatch.id} is duplicated.`);
    }
    lockedBatchIds.add(lockedBatch.id);
    for (const memberId of lockedBatch.memberIds) {
      if (lockedMemberIds.has(memberId)) {
        throw new Error(`Dispatch member ${memberId} is held by multiple active leases.`);
      }
      lockedMemberIds.add(memberId);
    }
  }
  const plannedStates: PlannedBatchState[] = [];
  const consideredIds = new Set<string>();
  const resourceGroupIds = [
    ...new Set([
      ...normalizedGroups.map((group) => group.resourceGroupId),
      ...normalizedLanes.map((lane) => lane.resourceGroupId),
      ...lockedBatches.map((batch) => batch.resourceGroupId),
    ]),
  ].sort(compareTechnicalStrings);
  for (const resourceGroupId of resourceGroupIds) {
    const groups = limitGroups(
      normalizedGroups.filter(
        (group) =>
          group.resourceGroupId === resourceGroupId &&
          group.attendanceStatus !== "MISSING" &&
          group.attendanceStatus !== "CLARIFICATION",
      ),
      limits,
    );
    groups.forEach((group) => {
      consideredIds.add(group.id);
    });
    plannedStates.push(
      ...planResourceGroup({
        groups,
        lanes: normalizedLanes.filter((lane) => lane.resourceGroupId === resourceGroupId),
        limits,
        previousSlots,
        previousExpectedAtByMember: previousExpectedAtByMember(input.previousPlan, resourceGroupId),
        lockedBatches: lockedBatches.filter((batch) => batch.resourceGroupId === resourceGroupId),
      }),
    );
  }
  plannedStates.sort(
    (left, right) =>
      left.expectedMs - right.expectedMs ||
      left.candidate.groups[0]?.resourceGroupId.localeCompare(
        right.candidate.groups[0]?.resourceGroupId ?? "",
      ) ||
      left.laneId.localeCompare(right.laneId) ||
      left.wave - right.wave,
  );
  const batches: DispatchBatch[] = plannedStates.map((entry, index) => {
    const lane = normalizedLanes.find((candidate) => candidate.id === entry.laneId);
    if (!lane) throw new Error(`Dispatch lane ${entry.laneId} disappeared during planning.`);
    const memberIds = entry.candidate.groups.map((group) => group.id);
    const orderedGroupIds = entry.candidate.groups.flatMap((group) => group.groupIds);
    const batchId =
      entry.fixedBatchId ??
      `dispatch-batch-${stableHash(
        [
          entry.candidate.groups[0]?.resourceGroupId ?? "",
          entry.candidate.productId,
          entry.candidate.gateId,
          ...orderedGroupIds,
          "members",
          ...memberIds,
        ].join("|"),
      )}`;
    return {
      id: batchId,
      resourceGroupId: entry.candidate.groups[0]?.resourceGroupId ?? "",
      productId: entry.candidate.productId,
      gateId: entry.candidate.gateId,
      laneId: entry.laneId,
      assumedAircraftId: lane.aircraftId,
      assumedPilotId: lane.pilotId,
      memberIds,
      groupIds: orderedGroupIds,
      occupiedSeats: entry.candidate.occupiedSeats,
      availableSeats: lane.passengerSeats - entry.candidate.occupiedSeats,
      dispatchOrder: index + 1,
      wave: entry.wave,
      boardingWindowLowerAt: new Date(entry.lowerMs).toISOString(),
      boardingWindowExpectedAt: new Date(entry.expectedMs).toISOString(),
      boardingWindowUpperAt: new Date(entry.upperMs).toISOString(),
      predictedCompletionAt: new Date(entry.completionMs).toISOString(),
      commitmentLevel: strongestCommitment(entry.candidate.groups),
      decisionReasons: entry.candidate.reasons,
    };
  });
  const batchByMemberId = new Map(
    batches.flatMap((batch) => batch.memberIds.map((memberId) => [memberId, batch] as const)),
  );
  const groupDecisions = normalizedGroups.flatMap<DispatchGroupDecision>((group) => {
    const batch = batchByMemberId.get(group.id);
    if (!batch) return [];
    const projectedOvertakeCount = normalizedGroups.filter((other) => {
      if (other.resourceGroupId !== group.resourceGroupId) return false;
      if (other.queueSequence <= group.queueSequence) return false;
      const otherBatch = batchByMemberId.get(other.id);
      return otherBatch !== undefined && otherBatch.dispatchOrder < batch.dispatchOrder;
    }).length;
    return [
      {
        memberId: group.id,
        batchId: batch.id,
        laneId: batch.laneId,
        dispatchOrder: batch.dispatchOrder,
        projectedOvertakeCount,
        decisionReasons: batch.decisionReasons,
      },
    ];
  });
  const unplannedGroups = normalizedGroups
    .filter((group) => !batchByMemberId.has(group.id))
    .sort(queueOrder)
    .map((group) => ({
      memberId: group.id,
      reason:
        group.attendanceStatus === "MISSING"
          ? ("ATTENDANCE_MISSING" as const)
          : group.attendanceStatus === "CLARIFICATION"
            ? ("ATTENDANCE_CLARIFICATION" as const)
            : consideredIds.has(group.id)
              ? unplannedReason(
                  group,
                  normalizedLanes.filter((lane) => lane.resourceGroupId === group.resourceGroupId),
                  plannedStates,
                )
              : ("NOT_IN_NEAR_DISPATCH_BATCH" as const),
    }));
  const revision = stableHash(
    batches
      .map((batch) =>
        [batch.resourceGroupId, batch.laneId, batch.wave, batch.productId, ...batch.memberIds].join(
          ":",
        ),
      )
      .join("|"),
  );
  return {
    planId: `dispatch-plan-${revision}`,
    revision,
    batches,
    groupDecisions,
    unplannedGroups,
    limits,
  };
}
