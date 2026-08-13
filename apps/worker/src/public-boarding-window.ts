import type { NonCanceledRotationState } from "@rundflug/domain";

export function predictedBoardingWindow(input: {
  status: NonCanceledRotationState;
  quality: "STABLE" | "CHANGING" | "UNCERTAIN";
  predictedBoardingAt: string | null;
  lowerMinutes: number;
  upperMinutes: number;
  referenceAt: string;
}): { lowerAt: string | null; upperAt: string | null } {
  if (input.status !== "DRAFT" || input.quality === "UNCERTAIN") {
    return { lowerAt: null, upperAt: null };
  }
  const referenceMs = Date.parse(input.referenceAt);
  const storedCenterMs = input.predictedBoardingAt
    ? Date.parse(input.predictedBoardingAt)
    : Number.NaN;
  const midpointMinutes = (input.lowerMinutes + input.upperMinutes) / 2;
  const lowerMs = Number.isFinite(storedCenterMs)
    ? storedCenterMs + (input.lowerMinutes - midpointMinutes) * 60_000
    : referenceMs + input.lowerMinutes * 60_000;
  const upperMs = Number.isFinite(storedCenterMs)
    ? storedCenterMs + (input.upperMinutes - midpointMinutes) * 60_000
    : referenceMs + input.upperMinutes * 60_000;
  return {
    lowerAt: new Date(lowerMs).toISOString(),
    upperAt: new Date(Math.max(lowerMs, upperMs)).toISOString(),
  };
}
