import { z } from "zod";

export const factoryResetRequestSchema = z
  .object({
    commandId: z.uuid(),
    eventId: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
    reason: z.string().trim().min(3).max(240),
    adminPin: z.string().regex(/^\d{6,12}$/),
    confirmation: z.literal("WERKSZUSTAND"),
    retainRecoveryBackup: z.boolean().default(true),
    deleteAllBackups: z.boolean().default(false),
  })
  .refine((input) => !(input.retainRecoveryBackup && input.deleteAllBackups), {
    message: "Eine zu behaltende Sicherung und das Löschen aller Sicherungen schließen sich aus.",
  });
export type FactoryResetRequest = z.infer<typeof factoryResetRequestSchema>;

export const factoryResetResponseSchema = z.object({
  resetComplete: z.literal(true),
  setupRequired: z.literal(true),
  recoveryBackupKey: z.string().nullable(),
  r2BackupsDeleted: z.boolean(),
});
export type FactoryResetResponse = z.infer<typeof factoryResetResponseSchema>;
