import type { PublicBoard } from "@rundflug/contracts";
import { formatBookingGroupLabel } from "@rundflug/domain";
import type {
  SimulationEvent,
  SimulationForecastSnapshot,
  SimulationResult,
  SimulationRotation,
} from "./model";

const MINUTE_MS = 60_000;
export const SIMULATION_DEPARTED_VISIBILITY_MS = 15_000;

type RotationLifecycle = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
type PublicGroup = PublicBoard["groups"][number];

export interface RecentDepartureState {
  previousVisibleAt: number;
  expiresAtByRotationId: Readonly<Record<string, number>>;
}

export function createRecentDepartureState(visibleAt: number): RecentDepartureState {
  return {
    previousVisibleAt: visibleAt,
    expiresAtByRotationId: {},
  };
}

export function advanceRecentDepartures(input: {
  state: RecentDepartureState;
  rotations: readonly SimulationRotation[];
  visibleAt: number;
  wallNow: number;
  reset?: boolean;
}): RecentDepartureState {
  if (input.reset || input.visibleAt < input.state.previousVisibleAt) {
    return createRecentDepartureState(input.visibleAt);
  }
  const expiresAtByRotationId = Object.fromEntries(
    Object.entries(input.state.expiresAtByRotationId).filter(([, expiresAt]) => {
      return expiresAt > input.wallNow;
    }),
  );
  for (const rotation of input.rotations) {
    if (!rotation.departedAt) continue;
    const departedAt = Date.parse(rotation.departedAt);
    if (departedAt > input.state.previousVisibleAt && departedAt <= input.visibleAt) {
      expiresAtByRotationId[rotation.id] = input.wallNow + SIMULATION_DEPARTED_VISIBILITY_MS;
    }
  }
  return {
    previousVisibleAt: input.visibleAt,
    expiresAtByRotationId,
  };
}

export function recentDepartureIds(
  state: RecentDepartureState,
  wallNow: number,
): ReadonlySet<string> {
  return new Set(
    Object.entries(state.expiresAtByRotationId)
      .filter(([, expiresAt]) => expiresAt > wallNow)
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
    return visibleMilestone(rotation.precalledAt, visibleAt) ? "COME_TO_FLIGHT_LINE" : "WAITING";
  }
  if (lifecycle === "CALLED") return "BOARDING";
  return lifecycle;
}

function statusPriority(
  rotation: SimulationRotation,
  lifecycle: RotationLifecycle,
  visibleAt: number,
): number {
  if (
    lifecycle === "CALLED" ||
    (lifecycle === "DRAFT" && visibleMilestone(rotation.precalledAt, visibleAt))
  ) {
    return 0;
  }
  if (lifecycle === "DRAFT") return 1;
  return 2;
}

function boardWindow(input: {
  lifecycle: RotationLifecycle;
  snapshot: SimulationForecastSnapshot | undefined;
  interrupted: boolean;
}): {
  lowerAt: string | null;
  upperAt: string | null;
  lowerMinutes: number;
  upperMinutes: number;
  quality: PublicGroup["predictionQuality"];
} {
  const quality = input.interrupted ? "UNCERTAIN" : (input.snapshot?.quality ?? "UNCERTAIN");
  const lowerMinutes = quality === "UNCERTAIN" ? 0 : Math.max(0, input.snapshot?.lowerMinutes ?? 0);
  const upperMinutes =
    quality === "UNCERTAIN"
      ? 0
      : Math.max(lowerMinutes, input.snapshot?.upperMinutes ?? lowerMinutes);
  if (input.lifecycle !== "DRAFT" || quality === "UNCERTAIN" || !input.snapshot) {
    return { lowerAt: null, upperAt: null, lowerMinutes, upperMinutes, quality };
  }
  const lowerMs = Date.parse(input.snapshot.predictedBoardingAt);
  if (!Number.isFinite(lowerMs)) {
    return { lowerAt: null, upperAt: null, lowerMinutes, upperMinutes, quality };
  }
  return {
    lowerAt: new Date(lowerMs).toISOString(),
    upperAt: new Date(lowerMs + (upperMinutes - lowerMinutes) * MINUTE_MS).toISOString(),
    lowerMinutes,
    upperMinutes,
    quality,
  };
}

export function createSimulationFidsBoard(input: {
  result: SimulationResult;
  visibleAt: number;
  recentDepartedRotationIds: ReadonlySet<string>;
}): PublicBoard {
  const interrupted = interruptionAt(input.result.events, input.visibleAt);
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
      return left.rotation.communicationNumber - right.rotation.communicationNumber;
    })
    .slice(0, 20);

  return {
    eventName: "Simulierter Veranstaltungstag",
    timeZone: "Europe/Berlin",
    selectedGate: null,
    emergencyMode: false,
    operationalInterrupted: interrupted,
    operationalNotice: interrupted ? "Der Rundflugbetrieb ist vorübergehend unterbrochen." : "",
    departedVisibilitySeconds: SIMULATION_DEPARTED_VISIBILITY_MS / 1_000,
    updatedAt: new Date(input.visibleAt).toISOString(),
    groups: visible.map(({ rotation, lifecycle }) => {
      const snapshot = snapshots.get(rotation.id);
      const window = boardWindow({ lifecycle, snapshot, interrupted });
      const bookingGroupLabel = formatBookingGroupLabel("SIM", rotation.communicationNumber);
      const boundAircraft =
        lifecycle === "DRAFT"
          ? null
          : (input.result.aircraft.find((entry) => entry.id === rotation.aircraftId)
              ?.registration ?? null);
      return {
        productName: "Rundflug Simulation",
        productCode: "SIM",
        gateLabel: "Flight Line 1",
        communicationNumber: rotation.communicationNumber,
        ticketLabels: Array.from(
          { length: rotation.passengerCount },
          (_, index) => `${bookingGroupLabel}/${index + 1}`,
        ),
        aircraftRegistration: boundAircraft,
        departedAt: rotation.departedAt,
        status: publicStatus(rotation, lifecycle, input.visibleAt),
        waitLowerMinutes: window.lowerMinutes,
        waitUpperMinutes: window.upperMinutes,
        boardingWindowLowerAt: window.lowerAt,
        boardingWindowUpperAt: window.upperAt,
        predictionQuality: window.quality,
        operationalNotice: interrupted
          ? "Flugbetrieb unterbrochen – bitte Status erneut prüfen."
          : "",
      };
    }),
    fleet: [],
  };
}
