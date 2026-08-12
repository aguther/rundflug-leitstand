import { z } from "zod";

export const assistClaimMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACQUIRE_OR_RENEW") }).strict(),
  z
    .object({
      action: z.literal("TAKEOVER"),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
]);
export type AssistClaimMutation = z.infer<typeof assistClaimMutationSchema>;

export const assistClaimSchema = z.object({
  aircraftId: z.string(),
  claimedByCurrentOperator: z.boolean(),
  ownerLoginCode: z.string(),
  revision: z.number().int().positive(),
  claimedAt: z.string(),
  expiresAt: z.string(),
});
export type AssistClaim = z.infer<typeof assistClaimSchema>;

export const dispatchRecommendationLeaseAcquireSchema = z
  .object({
    commandId: z.uuid(),
    aircraftId: z.string().min(1).max(100),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type DispatchRecommendationLeaseAcquire = z.infer<
  typeof dispatchRecommendationLeaseAcquireSchema
>;

export const dispatchRecommendationLeaseSchema = z
  .object({
    leaseId: z.uuid(),
    aircraftId: z.string().min(1).max(100),
    planRevision: z.string().min(1).max(100),
    batchId: z.string().min(1).max(100),
    dispatchOrder: z.number().int().positive(),
    groupIds: z.array(z.string().min(1).max(100)).min(1).max(12),
    occupiedSeats: z.number().int().positive(),
    availableSeats: z.number().int().nonnegative(),
    decisionReasons: z.array(z.string().min(1).max(100)).max(20),
    acquiredAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    serverNow: z.iso.datetime(),
  })
  .strict();
export type DispatchRecommendationLease = z.infer<typeof dispatchRecommendationLeaseSchema>;
