import type { RotationState } from "./index";

export type PublicRotationStatus =
  | "WAITING"
  | "PREPARE"
  | "COME_TO_FLIGHT_LINE"
  | "BOARDING"
  | "IN_FLIGHT"
  | "LANDED"
  | "COMPLETED";

export type PublicDraftStatus = Extract<
  PublicRotationStatus,
  "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE"
>;

export interface BookingGroupPartContext {
  partNumber: number;
  partCount: number;
  passengerCount: number;
}

export interface BookingGroupPartLabels {
  compact: string;
  long: string;
}

export function isSplitBookingGroupPart(context: BookingGroupPartContext): boolean {
  return context.partCount > 1;
}

export function formatBookingGroupPart(context: BookingGroupPartContext): BookingGroupPartLabels {
  if (
    !Number.isInteger(context.partNumber) ||
    !Number.isInteger(context.partCount) ||
    !Number.isInteger(context.passengerCount) ||
    context.partNumber < 1 ||
    context.partCount < 1 ||
    context.partNumber > context.partCount ||
    context.passengerCount < 1
  ) {
    throw new Error("Booking group part context must contain positive, consistent integers.");
  }
  return {
    compact: `Teilflug ${context.partNumber}/${context.partCount}`,
    long: `Teilflug ${context.partNumber} von ${context.partCount}`,
  };
}

export function derivePublicRotationStatus(input: {
  rotationState: Exclude<RotationState, "CANCELED">;
  draftStatus: PublicDraftStatus;
}): PublicRotationStatus {
  switch (input.rotationState) {
    case "DRAFT":
      return input.draftStatus;
    case "CALLED":
      return "BOARDING";
    case "IN_FLIGHT":
    case "LANDED":
    case "COMPLETED":
      return input.rotationState;
  }
}
