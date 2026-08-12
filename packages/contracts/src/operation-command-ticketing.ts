import { z } from "zod";

import { commandBaseSchema } from "./operation-command-base";

export const ticketingCommandSchemas = [
  commandBaseSchema.extend({
    type: z.literal("SELL_TICKET_GROUP"),
    payload: z
      .object({
        productId: z.string().min(1).max(100),
        ticketCount: z.number().int().min(1).max(12),
        ticketDetails: z
          .array(
            z.object({
              weightClass: z.enum(["NOT_CAPTURED", "CHILD", "NORMAL", "HEAVY", "INDIVIDUAL"]),
              individualWeightKg: z.number().min(15).max(250).nullable(),
            }),
          )
          .min(1)
          .max(12)
          .optional(),
        standby: z.boolean().default(false),
        paymentStatus: z.enum(["UNPAID", "PAID", "WAIVED", "INFORMATIONAL_ONLY"]),
        paymentMethod: z.enum(["CASH", "CARD", "VOUCHER", "OTHER"]).nullable(),
        oversizeSplitAcknowledged: z.boolean().default(false),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.enum(["DEFER_TICKET_GROUP", "MARK_NO_SHOW"]),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CANCEL_TICKET_GROUP"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("MOVE_TICKET_GROUP"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      targetRotationId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CORRECT_ROTATION_MANIFEST"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      targetRotationId: z.string().min(1).max(100),
      reason: z.string().trim().min(10).max(500),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_TICKET_ATTENDANCE"),
    payload: z.object({
      ticketId: z.string().min(1).max(100),
      checkedIn: z.boolean(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_TICKET_GROUP_ATTENDANCE"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      checkedIn: z.boolean(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("MARK_TICKET_GROUP_MISSING"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("START_TICKET_GROUP_RECALL"),
    payload: z.object({ ticketGroupId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CLEAR_TICKET_GROUP_RECALL"),
    payload: z.object({
      ticketGroupId: z.string().min(1).max(100),
      recallId: z.uuid(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("RESTORE_TICKET_GROUP_TO_QUEUE"),
    payload: z.object({ ticketGroupId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.literal("RECALL_TICKET_GROUP"),
    payload: z.object({ ticketGroupId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.literal("MARK_TICKET_NO_SHOW"),
    payload: z.object({
      ticketId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CONFIRM_ATTENDANCE_DECISION"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      decision: z.enum(["FLY_WITH_PRESENT", "LEAVE_SEAT_EMPTY"]),
    }),
  }),
] as const;

export type TicketingCommand = z.infer<(typeof ticketingCommandSchemas)[number]>;
