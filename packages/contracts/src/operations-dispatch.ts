import { z } from "zod";

import { eventSnapshotSchema } from "./event-auth";
import { administrationCommandSchemas } from "./operation-command-administration";
import { flightCommandSchemas } from "./operation-command-flight";
import { planningCommandSchemas } from "./operation-command-planning";
import { ticketingCommandSchemas } from "./operation-command-ticketing";
import { saleReceiptSchema } from "./sale-receipt";

export * from "./operation-assistance";
export * from "./operation-board";
export * from "./operation-command-administration";
export * from "./operation-command-base";
export * from "./operation-command-flight";
export * from "./operation-command-planning";
export * from "./operation-command-ticketing";

export const commandEnvelopeSchema = z.discriminatedUnion("type", [
  ...administrationCommandSchemas,
  ...flightCommandSchemas,
  ...planningCommandSchemas,
  ...ticketingCommandSchemas,
]);

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export const commandResultSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
  event: eventSnapshotSchema,
  eventType: z.string(),
  aggregate: z
    .object({
      type: z.enum([
        "OPERATION_DAY",
        "PRODUCT",
        "RESOURCE_GROUP",
        "DEVICE",
        "AIRCRAFT",
        "PILOT",
        "TICKET",
        "GATE",
        "TICKET_GROUP",
        "TICKET_GROUP_RECALL",
        "ROTATION",
        "RECOVERY_BATCH",
        "OPERATIONAL_PLAN",
        "OPERATIONAL_RULE",
      ]),
      id: z.string(),
      relatedRotationId: z.string().optional(),
    })
    .optional(),
  saleReceipt: saleReceiptSchema.optional(),
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
