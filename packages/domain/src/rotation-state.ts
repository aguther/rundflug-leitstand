import { DomainRuleError } from "./domain-rule-error";

export type RotationState = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED" | "CANCELED";

export const rotationStateLabels: Readonly<Record<RotationState, string>> = {
  DRAFT: "Wartend",
  CALLED: "Boarding",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
  CANCELED: "Storniert",
};

const allowedRotationTransitions: Readonly<Record<RotationState, readonly RotationState[]>> = {
  DRAFT: ["CALLED"],
  CALLED: ["IN_FLIGHT", "DRAFT", "CANCELED"],
  IN_FLIGHT: ["LANDED"],
  LANDED: ["COMPLETED"],
  COMPLETED: [],
  CANCELED: [],
};

export function transitionRotation(current: RotationState, next: RotationState): RotationState {
  if (!allowedRotationTransitions[current].includes(next)) {
    throw new DomainRuleError(
      "ROTATION_TRANSITION_NOT_ALLOWED",
      `Übergang ${current} → ${next} ist nicht zulässig.`,
    );
  }
  return next;
}
