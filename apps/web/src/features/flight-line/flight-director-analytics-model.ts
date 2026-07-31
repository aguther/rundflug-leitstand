import type { ForecastHistory, OperationBoard, ResourceDayHistory } from "@rundflug/contracts";
import { formatBookingGroupLabel } from "@rundflug/domain";

const MINUTE_MS = 60_000;

export type ForecastEntry = ForecastHistory["entries"][number];
type Rotation = OperationBoard["rotations"][number];

export interface AnalyticsTicketGroup {
  id: string;
  label: string;
  productName: string;
  soldAt: string;
  rotationIds: string[];
}

export interface ResourceTimelinePhase {
  type: "BOARDING" | "FLIGHT" | "TURNAROUND";
  startPercent: number;
  endPercent: number;
}

export interface ResourceTimelineRotation {
  id: string;
  label: string;
  startPercent: number;
  endPercent: number;
  phases: ResourceTimelinePhase[];
  rotation: ResourceDayHistory["rotations"][number];
}

export function analyticsTicketGroups(rotations: readonly Rotation[]): AnalyticsTicketGroup[] {
  const groups = new Map<string, AnalyticsTicketGroup>();
  for (const rotation of rotations) {
    const bookingGroups =
      rotation.bookingGroups.length > 0
        ? rotation.bookingGroups
        : [
            {
              id: rotation.ticketGroupId,
              communicationNumber: rotation.communicationNumber,
              soldAt: "",
            },
          ];
    for (const group of bookingGroups) {
      const existing = groups.get(group.id);
      if (existing) {
        if (!existing.rotationIds.includes(rotation.id)) existing.rotationIds.push(rotation.id);
        continue;
      }
      groups.set(group.id, {
        id: group.id,
        label: formatBookingGroupLabel(rotation.productCode, group.communicationNumber),
        productName: rotation.productName,
        soldAt: group.soldAt,
        rotationIds: [rotation.id],
      });
    }
  }
  return [...groups.values()].sort(
    (left, right) =>
      left.soldAt.localeCompare(right.soldAt) ||
      left.label.localeCompare(right.label, "de-DE", { numeric: true }),
  );
}

function percentAt(value: number, from: number, until: number): number {
  const span = Math.max(1, until - from);
  return Math.min(100, Math.max(0, ((value - from) / span) * 100));
}

export function resourceTimelineRotations(history: ResourceDayHistory): ResourceTimelineRotation[] {
  const from = Date.parse(history.from);
  const until = Date.parse(history.until);
  return history.rotations.flatMap((rotation) => {
    if (!rotation.actual.boardingAt) return [];
    const start = Math.max(from, Date.parse(rotation.actual.boardingAt));
    const end = Math.min(until, Date.parse(rotation.actual.completionAt ?? history.observedUntil));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < from || start > until) return [];
    const boundedEnd = Math.max(start + 1, end);
    const departure = rotation.actual.departureAt
      ? Math.min(boundedEnd, Math.max(start, Date.parse(rotation.actual.departureAt)))
      : null;
    const landing = rotation.actual.landingAt
      ? Math.min(boundedEnd, Math.max(departure ?? start, Date.parse(rotation.actual.landingAt)))
      : null;
    const phases: ResourceTimelinePhase[] = [];
    phases.push({
      type: "BOARDING",
      startPercent: percentAt(start, from, until),
      endPercent: percentAt(departure ?? boundedEnd, from, until),
    });
    if (departure !== null) {
      phases.push({
        type: "FLIGHT",
        startPercent: percentAt(departure, from, until),
        endPercent: percentAt(landing ?? boundedEnd, from, until),
      });
    }
    if (landing !== null) {
      phases.push({
        type: "TURNAROUND",
        startPercent: percentAt(landing, from, until),
        endPercent: percentAt(boundedEnd, from, until),
      });
    }
    return [
      {
        id: rotation.rotationId,
        label: rotation.communicationLabel,
        startPercent: percentAt(start, from, until),
        endPercent: percentAt(boundedEnd, from, until),
        phases,
        rotation,
      },
    ];
  });
}

export function sortedForecastEntries(entries: readonly ForecastEntry[]): ForecastEntry[] {
  return [...entries].sort(
    (left, right) =>
      Date.parse(left.capturedAt) - Date.parse(right.capturedAt) ||
      left.snapshotId.localeCompare(right.snapshotId),
  );
}

export function forecastChartData(entries: readonly ForecastEntry[]) {
  return sortedForecastEntries(entries).map((entry) => ({
    capturedAt: Date.parse(entry.capturedAt),
    boardingAt: entry.predicted.boardingAt ? Date.parse(entry.predicted.boardingAt) : null,
    departureAt: entry.predicted.departureAt ? Date.parse(entry.predicted.departureAt) : null,
    landingAt: entry.predicted.landingAt ? Date.parse(entry.predicted.landingAt) : null,
    completionAt: entry.predicted.completionAt ? Date.parse(entry.predicted.completionAt) : null,
  }));
}

export function boardingForecastChangeMinutes(entries: readonly ForecastEntry[]): number | null {
  const sorted = sortedForecastEntries(entries);
  const latest = sorted.at(-1)?.predicted.boardingAt;
  const previous = sorted.at(-2)?.predicted.boardingAt;
  if (!latest || !previous) return null;
  return Math.round((Date.parse(latest) - Date.parse(previous)) / MINUTE_MS);
}

function durationMinutes(start: string | null, end: string | null, fallbackEnd: string): number {
  if (!start) return 0;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end ?? fallbackEnd);
  return Math.max(0, (endMs - startMs) / MINUTE_MS);
}

export function resourceDayMetrics(history: ResourceDayHistory) {
  const completed = history.rotations.filter((rotation) => rotation.actual.completionAt);
  const bindingMinutes = history.rotations.reduce(
    (total, rotation) =>
      total +
      durationMinutes(
        rotation.actual.boardingAt,
        rotation.actual.completionAt,
        history.observedUntil,
      ),
    0,
  );
  const turnaroundDurations = completed
    .map((rotation) =>
      durationMinutes(
        rotation.actual.landingAt,
        rotation.actual.completionAt,
        history.observedUntil,
      ),
    )
    .filter((duration) => duration > 0);
  const flightMinutes = history.rotations.reduce(
    (total, rotation) =>
      total +
      durationMinutes(
        rotation.actual.departureAt,
        rotation.actual.landingAt,
        history.observedUntil,
      ),
    0,
  );
  const pauseMinutes = history.blocks
    .filter((block) => block.type === "PAUSE")
    .reduce(
      (total, block) =>
        total + durationMinutes(block.startedAt, block.endedAt, history.observedUntil),
      0,
    );
  const utilization =
    history.rotations.length === 0
      ? null
      : history.rotations.reduce(
          (total, rotation) =>
            total + Math.min(1, rotation.passengerCount / rotation.usableCapacity),
          0,
        ) / history.rotations.length;

  return {
    completedRotations: completed.length,
    bindingMinutes,
    averageTurnaroundMinutes:
      turnaroundDurations.length === 0
        ? null
        : turnaroundDurations.reduce((sum, duration) => sum + duration, 0) /
          turnaroundDurations.length,
    flightMinutes,
    pauseMinutes,
    averageSeatUtilization: utilization,
  };
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "–";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} Min.`;
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")} Std.`;
}
