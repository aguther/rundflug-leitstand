import { z } from "zod";

export const appEnvironmentSchema = z.enum(["development", "acceptance", "production"]);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export const commandEnvelopeSchema = z.object({
  commandId: z.uuid(),
  eventId: z.string().min(1).max(100),
  deviceId: z.string().min(1).max(100),
  expectedVersion: z.number().int().nonnegative(),
  issuedAt: z.iso.datetime(),
  type: z.literal("SET_OPERATIONAL_NOTE"),
  payload: z.object({
    note: z.string().trim().max(240),
  }),
});

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
