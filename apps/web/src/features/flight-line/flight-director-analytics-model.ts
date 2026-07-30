import type { ForecastHistory, ResourceDayHistory } from "@rundflug/contracts";

const MINUTE_MS = 60_000;

export type ForecastEntry = ForecastHistory["entries"][number];

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
