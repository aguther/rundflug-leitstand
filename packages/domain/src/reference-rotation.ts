export interface ReferenceRotationBreakdown {
  boardingMinutes: number;
  offBlockToOnBlockMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
  totalMinutes: number;
}

export type ReferenceRotationInput = Omit<ReferenceRotationBreakdown, "totalMinutes">;

export function deriveReferenceRotationBreakdown(
  input: ReferenceRotationInput,
): ReferenceRotationBreakdown {
  return {
    ...input,
    totalMinutes:
      input.boardingMinutes +
      input.offBlockToOnBlockMinutes +
      input.deboardingMinutes +
      input.bufferMinutes,
  };
}
