import { z } from "zod";
import { ticketGroupPrintDataSchema } from "./tickets-public-status";

const publicStatusCodeSchema = z.string().regex(/^[A-Z2-9]{12,32}$/);

export const saleReceiptSchema = ticketGroupPrintDataSchema.extend({
  // Optional only for replaying receipts persisted before server-side code allocation.
  ticketCodes: z.array(publicStatusCodeSchema).min(1).max(12).optional(),
});
