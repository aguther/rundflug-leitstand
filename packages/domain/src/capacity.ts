import type { PredictionQuality } from "./forecast";

export type CapacityStatus = "AVAILABLE" | "LIMITED" | "MANUAL_REVIEW" | "SOLD_OUT";

export interface CapacityAssessment {
  remainingSellableSeats: number;
  projectedSeats: number;
  status: CapacityStatus;
  saleRecommended: boolean;
}

export function assessRemainingCapacity(input: {
  remainingOperatingMinutes: number;
  expectedRotationMinutes: number;
  activeAircraftSeats: readonly number[];
  openTickets: number;
  reservedSeats?: number;
  predictionQuality: PredictionQuality;
  warningThreshold: number;
  criticalThreshold: number;
}): CapacityAssessment {
  const cycles = Math.max(
    0,
    Math.floor(input.remainingOperatingMinutes / Math.max(1, input.expectedRotationMinutes)),
  );
  const rawProjectedSeats =
    cycles *
    input.activeAircraftSeats
      .filter((seats) => Number.isInteger(seats) && seats > 0)
      .reduce((sum, seats) => sum + seats, 0);
  const qualityFactor =
    input.predictionQuality === "STABLE" ? 1 : input.predictionQuality === "CHANGING" ? 0.85 : 0.6;
  const projectedSeats = Math.max(
    0,
    Math.floor(rawProjectedSeats * qualityFactor) - Math.max(0, input.reservedSeats ?? 0),
  );
  const remainingSellableSeats = Math.max(0, projectedSeats - Math.max(0, input.openTickets));
  const status: CapacityStatus =
    remainingSellableSeats === 0
      ? "SOLD_OUT"
      : remainingSellableSeats <= input.criticalThreshold
        ? "MANUAL_REVIEW"
        : remainingSellableSeats <= input.warningThreshold
          ? "LIMITED"
          : "AVAILABLE";
  return {
    remainingSellableSeats,
    projectedSeats,
    status,
    saleRecommended: status === "AVAILABLE" || status === "LIMITED",
  };
}
