import { z } from "zod";

export const dispatchDecisionDetailsSchema = z.object({
  protectedCommitments: z.number().int().nonnegative(),
  mustServeForMaximumWait: z.number().int().nonnegative(),
  mustServeForMaximumOvertakes: z.number().int().nonnegative(),
  productServiceDeficit: z.number().nonnegative(),
  oldestWaitMinutes: z.number().nonnegative(),
  occupiedSeats: z.number().int().nonnegative(),
  availableSeats: z.number().int().nonnegative(),
  projectedOvertakes: z.number().int().nonnegative(),
  retainedPreviousPlanMembers: z.number().int().nonnegative(),
});

export type DispatchDecisionDetails = z.infer<typeof dispatchDecisionDetailsSchema>;
