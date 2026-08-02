import type { FidsBoardRow, PublicBoard } from "@rundflug/contracts";
import { derivePublicForecastProjection, formatBookingGroupLabel } from "@rundflug/domain";
import type {
  SimulationEvent,
  SimulationForecastSnapshot,
  SimulationResult,
  SimulationRotation,
} from "./model";

const MINUTE_MS = 60_000;
export const SIMULATION_DEPARTED_VISIBILITY_MS = 15_000;
export const SIMULATION_DEPARTED_MINIMUM_VISIBILITY_MS = 1_000;

type RotationLifecycle = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
type PublicGroup = PublicBoard["groups"][number];
export type SimulationFidsBoard = Omit<PublicBoard, "groups"> & { groups: FidsBoardRow[] };

export interface RecentDepartureState {
  previousVisibleAt: number;
  observedAtByRotationId: Readonly<Record<string, number>>;
  visibilityMs: number;
}

export function simulationDepartedVisibilityMs(speed: number): number {
  const normalizedSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.max(
    SIMULATION_DEPARTED_MINIMUM_VISIBILITY_MS,
    SIMULATION_DEPARTED_VISIBILITY_MS / normalizedSpeed,
  );
}

export function createRecentDepartureState(
  visibleAt: number,
  visibilityMs = SIMULATION_DEPARTED_VISIBILITY_MS,
): RecentDepartureState {
  return {
    previousVisibleAt: visibleAt,
    observedAtByRotationId: {},
    visibilityMs,
  };
}

export function advanceRecentDepartures(input: {
  state: RecentDepartureState;
  rotations: readonly SimulationRotation[];
  visibleAt: number;
  wallNow: number;
  visibilityMs: number;
  reset?: boolean;
}): RecentDepartureState {
  if (input.reset || input.visibleAt < input.state.previousVisibleAt) {
    return createRecentDepartureState(input.visibleAt, input.visibilityMs);
  }
  const effectiveVisibilityMs = Math.min(input.state.visibilityMs, input.visibilityMs);
  const observedAtByRotationId = Object.fromEntries(
    Object.entries(input.state.observedAtByRotationId).filter(([, observedAt]) => {
      return input.wallNow - observedAt < effectiveVisibilityMs;
    }),
  );
  for (const rotation of input.rotations) {
    if (!rotation.departedAt) continue;
    const departedAt = Date.parse(rotation.departedAt);
    if (departedAt > input.state.previousVisibleAt && departedAt <= input.visibleAt) {
      observedAtByRotationId[rotation.id] = input.wallNow;
    }
  }
  return {
    previousVisibleAt: input.visibleAt,
    observedAtByRotationId,
    visibilityMs: input.visibilityMs,
  };
}

export function recentDepartureIds(
  state: RecentDepartureState,
  wallNow: number,
  visibilityMs = state.visibilityMs,
): ReadonlySet<string> {
  const effectiveVisibilityMs = Math.min(state.visibilityMs, visibilityMs);
  return new Set(
    Object.entries(state.observedAtByRotationId)
      .filter(([, observedAt]) => wallNow - observedAt < effectiveVisibilityMs)
      .map(([rotationId]) => rotationId),
  );
}

function visibleMilestone(value: string | null, visibleAt: number): boolean {
  return value !== null && Date.parse(value) <= visibleAt;
}

function lifecycleAt(rotation: SimulationRotation, visibleAt: number): RotationLifecycle {
  if (!visibleMilestone(rotation.calledAt, visibleAt)) return "DRAFT";
  if (!visibleMilestone(rotation.departedAt, visibleAt)) return "CALLED";
  if (!visibleMilestone(rotation.landedAt, visibleAt)) return "IN_FLIGHT";
  if (!visibleMilestone(rotation.completedAt, visibleAt)) return "LANDED";
  return "COMPLETED";
}

function interruptionAt(events: readonly SimulationEvent[], visibleAt: number): boolean {
  let interrupted = false;
  for (const event of events) {
    if (Date.parse(event.occurredAt) > visibleAt) break;
    if (event.type === "EVENT_INTERRUPTED") interrupted = true;
    if (event.type === "EVENT_RESUMED") interrupted = false;
  }
  return interrupted;
}

function activePlannedOperationIds(
  events: readonly SimulationEvent[],
  visibleAt: number,
): ReadonlySet<string> {
  const active = new Set<string>();
  for (const event of events) {
    if (Date.parse(event.occurredAt) > visibleAt) break;
    if (!event.plannedOperationId) continue;
    if (event.type === "PLANNED_OPERATION_STARTED") {
      active.add(event.plannedOperationId);
    }
    if (event.type === "PLANNED_OPERATION_ENDED") {
      active.delete(event.plannedOperationId);
    }
  }
  return active;
}

function latestSnapshotsAt(
  snapshots: readonly SimulationForecastSnapshot[],
  visibleAt: number,
): ReadonlyMap<string, SimulationForecastSnapshot> {
  const latest = new Map<string, SimulationForecastSnapshot>();
  for (const snapshot of snapshots) {
    if (Date.parse(snapshot.capturedAt) <= visibleAt) {
      latest.set(snapshot.rotationId, snapshot);
    }
  }
  return latest;
}

function publicStatus(
  rotation: SimulationRotation,
  lifecycle: RotationLifecycle,
  visibleAt: number,
): PublicGroup["status"] {
  if (lifecycle === "DRAFT") {
    if (visibleMilestone(rotation.precalledAt, visibleAt)) return "COME_TO_FLIGHT_LINE";
    return rotation.precallStatus === "PREPARE" ? "PREPARE" : "WAITING";
  }
  if (lifecycle === "CALLED") return "BOARDING";
  return lifecycle;
}

function statusPriority(
  rotation: SimulationRotation,
  lifecycle: RotationLifecycle,
  visibleAt: number,
): number {
  if (lifecycle === "CALLED") return 0;
  if (lifecycle === "DRAFT" && visibleMilestone(rotation.precalledAt, visibleAt)) return 1;
  if (lifecycle === "DRAFT" && rotation.precallStatus === "PREPARE") return 2;
  if (lifecycle === "DRAFT") return 3;
  return 4;
}

function boardWindow(input: {
  lifecycle: RotationLifecycle;
  snapshot: SimulationForecastSnapshot | undefined;
  interrupted: boolean;
  operationsEndAt: string;
}): {
  lowerAt: string | null;
  upperAt: string | null;
  lowerMinutes: number;
  upperMinutes: number;
  quality: PublicGroup["predictionQuality"];
  forecastState: PublicGroup["forecastState"];
  forecastReason: PublicGroup["forecastReason"];
} {
  const quality = input.interrupted ? "UNCERTAIN" : (input.snapshot?.quality ?? "UNCERTAIN");
  const lowerMinutes = quality === "UNCERTAIN" ? 0 : Math.max(0, input.snapshot?.lowerMinutes ?? 0);
  const upperMinutes =
    quality === "UNCERTAIN"
      ? 0
      : Math.max(lowerMinutes, input.snapshot?.upperMinutes ?? lowerMinutes);
  const publicForecast = derivePublicForecastProjection({
    rotationStatus: input.lifecycle,
    predictionQuality: quality,
    predictedBoardingAt: input.snapshot?.predictedBoardingAt ?? null,
    predictedCompletionAt: input.snapshot?.predictedCompletionAt ?? null,
    operationsEndAt: input.operationsEndAt,
    dispatchBatchId: input.snapshot?.dispatchBatchId ?? null,
    dispatchUnplannedReason: input.snapshot?.dispatchUnplannedReason ?? null,
    emergencyMode: false,
    operationalInterrupted: input.interrupted,
    resourceGroupStatus: "ACTIVE",
  });
  const forecastState = input.snapshot?.forecastState ?? publicForecast.forecastState;
  const forecastReason = input.snapshot?.forecastReason ?? publicForecast.forecastReason;
  const publishesWindow =
    forecastState === "DISPATCH_WINDOW" || forecastState === "LONG_RANGE_WINDOW";
  if (
    input.lifecycle !== "DRAFT" ||
    quality === "UNCERTAIN" ||
    !input.snapshot ||
    !publishesWindow
  ) {
    return {
      lowerAt: null,
      upperAt: null,
      lowerMinutes,
      upperMinutes,
      quality,
      forecastState,
      forecastReason,
    };
  }
  const lowerMs = Date.parse(input.snapshot.predictedBoardingAt);
  if (!Number.isFinite(lowerMs)) {
    return {
      lowerAt: null,
      upperAt: null,
      lowerMinutes,
      upperMinutes,
      quality,
      forecastState: "UNAVAILABLE",
      forecastReason: null,
    };
  }
  return {
    lowerAt: new Date(lowerMs).toISOString(),
    upperAt: new Date(lowerMs + (upperMinutes - lowerMinutes) * MINUTE_MS).toISOString(),
    lowerMinutes,
    upperMinutes,
    quality,
    forecastState,
    forecastReason,
  };
}

export function createSimulationFidsBoard(input: {
  result: SimulationResult;
  visibleAt: number;
  recentDepartedRotationIds: ReadonlySet<string>;
}): SimulationFidsBoard {
  const manuallyInterrupted = interruptionAt(input.result.events, input.visibleAt);
  const activePlanIds = activePlannedOperationIds(input.result.events, input.visibleAt);
  const activePlans = (input.result.plannedOperations ?? []).filter((entry) =>
    activePlanIds.has(entry.key),
  );
  const activeEventPlan = activePlans.find((entry) => entry.scopeType === "EVENT");
  const interrupted = manuallyInterrupted || activeEventPlan !== undefined;
  const globalNotice =
    activeEventPlan?.publicNote ||
    (interrupted ? "Der Rundflugbetrieb ist vorübergehend unterbrochen." : "");
  const snapshots = latestSnapshotsAt(input.result.snapshots, input.visibleAt);
  const visible = input.result.rotations
    .filter((rotation) => Date.parse(rotation.createdAt) <= input.visibleAt)
    .map((rotation) => ({
      rotation,
      lifecycle: lifecycleAt(rotation, input.visibleAt),
    }))
    .filter(({ rotation, lifecycle }) => {
      return (
        lifecycle === "DRAFT" ||
        lifecycle === "CALLED" ||
        input.recentDepartedRotationIds.has(rotation.id)
      );
    })
    .sort((left, right) => {
      const priority =
        statusPriority(left.rotation, left.lifecycle, input.visibleAt) -
        statusPriority(right.rotation, right.lifecycle, input.visibleAt);
      if (priority !== 0) return priority;
      if (left.lifecycle !== "DRAFT" && left.lifecycle !== "CALLED") {
        return (
          Date.parse(right.rotation.departedAt ?? "") - Date.parse(left.rotation.departedAt ?? "")
        );
      }
      if (left.lifecycle === "DRAFT" && right.lifecycle === "DRAFT") {
        const dispatchDifference =
          (left.rotation.dispatchOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.rotation.dispatchOrder ?? Number.MAX_SAFE_INTEGER);
        if (dispatchDifference !== 0) return dispatchDifference;
        const predictionDifference =
          Date.parse(snapshots.get(left.rotation.id)?.predictedBoardingAt ?? "") -
          Date.parse(snapshots.get(right.rotation.id)?.predictedBoardingAt ?? "");
        if (Number.isFinite(predictionDifference) && predictionDifference !== 0) {
          return predictionDifference;
        }
      }
      return (
        left.rotation.communicationNumber - right.rotation.communicationNumber ||
        left.rotation.id.localeCompare(right.rotation.id)
      );
    });

  return {
    eventName: input.result.config.operationalModel?.sourceName ?? "Simulierter Veranstaltungstag",
    timeZone: input.result.config.schedule.timeZone,
    selectedGate: null,
    emergencyMode: false,
    operationalInterrupted: interrupted,
    operationalNotice: globalNotice,
    departedVisibilitySeconds: SIMULATION_DEPARTED_VISIBILITY_MS / 1_000,
    updatedAt: new Date(input.visibleAt).toISOString(),
    groups: visible.map(({ rotation, lifecycle }) => {
      const activeGroupPlan = activePlans.find(
        (entry) =>
          entry.scopeType === "RESOURCE_GROUP" && entry.scopeId === rotation.resourceGroupId,
      );
      const rotationInterrupted = interrupted || activeGroupPlan !== undefined;
      const snapshot = snapshots.get(rotation.id);
      const window = boardWindow({
        lifecycle,
        snapshot,
        interrupted,
        operationsEndAt: input.result.config.schedule.operationsEndAt,
      });
      const productCode = rotation.productCode ?? "SIM";
      const model = input.result.config.operationalModel;
      const product = model?.products.find((entry) => entry.id === rotation.productId);
      const resourceGroup = model?.resourceGroups.find(
        (entry) => entry.id === rotation.resourceGroupId,
      );
      const bookingGroupLabel = formatBookingGroupLabel(productCode, rotation.communicationNumber);
      const boundAircraft =
        lifecycle === "DRAFT"
          ? null
          : (input.result.aircraft.find((entry) => entry.id === rotation.aircraftId)
              ?.registration ?? null);
      return {
        rowId: rotation.id,
        productId: rotation.productId ?? product?.id ?? `simulation-product:${productCode}`,
        gateId: product?.gateId ?? resourceGroup?.gateId ?? null,
        productName: rotation.productName ?? "Rundflug Simulation",
        productCode,
        gateLabel: rotation.gateLabel ?? "Flight Line 1",
        communicationNumber: rotation.communicationNumber,
        ticketLabels: Array.from(
          { length: rotation.passengerCount },
          (_, index) => `${bookingGroupLabel}/${index + 1}`,
        ),
        aircraftRegistration: boundAircraft,
        departedAt: rotation.departedAt,
        status: activeGroupPlan
          ? "SERVICE_PAUSED"
          : publicStatus(rotation, lifecycle, input.visibleAt),
        waitLowerMinutes: window.lowerMinutes,
        waitUpperMinutes: window.upperMinutes,
        boardingWindowLowerAt: window.lowerAt,
        boardingWindowUpperAt: window.upperAt,
        predictionQuality: window.quality,
        forecastState: window.forecastState,
        forecastReason: window.forecastReason,
        dispatchOrder: rotation.dispatchOrder ?? null,
        operationalNotice:
          activeGroupPlan?.publicNote ||
          (rotationInterrupted ? "Flugbetrieb unterbrochen – bitte Status erneut prüfen." : ""),
        activeRecall: null,
      };
    }),
    fleet: [],
  };
}
