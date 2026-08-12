import { z } from "zod";

export const commandPreconditionSchema = z
  .object({
    aggregateType: z.enum(["ROTATION", "AIRCRAFT"]),
    aggregateId: z.string().min(1).max(100),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export type CommandPrecondition = z.infer<typeof commandPreconditionSchema>;

export const commandBaseSchema = z.object({
  commandId: z.uuid(),
  eventId: z.string().min(1).max(100),
  deviceId: z.string().min(1).max(100),
  expectedVersion: z.number().int().nonnegative(),
  observedEventVersion: z.number().int().nonnegative().optional(),
  preconditions: z.array(commandPreconditionSchema).length(1).optional(),
  issuedAt: z.iso.datetime(),
});
