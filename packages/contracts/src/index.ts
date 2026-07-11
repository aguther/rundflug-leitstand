import { z } from "zod";

export const appEnvironmentSchema = z.enum(["development", "acceptance", "production"]);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

const commandBaseSchema = z.object({
  commandId: z.uuid(),
  eventId: z.string().min(1).max(100),
  deviceId: z.string().min(1).max(100),
  expectedVersion: z.number().int().nonnegative(),
  issuedAt: z.iso.datetime(),
});

export const commandEnvelopeSchema = z.discriminatedUnion("type", [
  commandBaseSchema.extend({
    type: z.literal("SET_OPERATIONAL_NOTE"),
    payload: z.object({
      note: z.string().trim().max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SELL_TICKET_GROUP"),
    payload: z.object({
      productId: z.string().min(1).max(100),
      publicTicketCodes: z.array(z.string().min(12).max(32)).min(1).max(12),
      standby: z.boolean().default(false),
      paymentStatus: z.enum(["UNPAID", "PAID", "WAIVED", "INFORMATIONAL_ONLY"]),
      paymentMethod: z.enum(["CASH", "CARD", "VOUCHER", "OTHER"]).nullable(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.enum(["CALL_NEXT", "MARK_IN_FLIGHT", "MARK_LANDED", "MARK_COMPLETED"]),
    payload: z.object({ rotationId: z.string().min(1).max(100) }),
  }),
]);

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export const eventSnapshotSchema = z.object({
  eventId: z.string(),
  name: z.string(),
  eventDate: z.string(),
  timeZone: z.string(),
  status: z.string(),
  emergencyMode: z.boolean(),
  version: z.number().int().nonnegative(),
  operationalNote: z.string(),
  updatedAt: z.string(),
});

export type EventSnapshot = z.infer<typeof eventSnapshotSchema>;

export const commandResultSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
  event: eventSnapshotSchema,
  eventType: z.string(),
  aggregate: z
    .object({
      type: z.enum(["OPERATION_DAY", "TICKET_GROUP", "ROTATION"]),
      id: z.string(),
      relatedRotationId: z.string().optional(),
    })
    .optional(),
});
export type CommandResult = z.infer<typeof commandResultSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    currentVersion: z.number().int().nonnegative().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
