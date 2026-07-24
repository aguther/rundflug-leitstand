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
