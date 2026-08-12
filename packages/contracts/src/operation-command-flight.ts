import { z } from "zod";

import { commandBaseSchema } from "./operation-command-base";

export const flightCommandSchemas = [
  commandBaseSchema.extend({
    type: z.literal("SET_ROTATION_CAPACITY"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      usableCapacity: z.number().int().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("ASSIGN_AIRCRAFT_PILOT"),
    payload: z.object({
      aircraftId: z.string().min(1).max(100),
      pilotId: z.string().min(1).max(100),
      reassign: z.boolean(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CALL_NEXT"),
    payload: z.object({
      ticketGroupIds: z.array(z.string().min(1).max(100)).min(1).max(12),
      aircraftId: z.string().min(1).max(100),
      pilotId: z.string().min(1).max(100),
      dispatchRecommendation: z
        .object({
          planRevision: z.string().min(1).max(100),
          batchId: z.string().min(1).max(100),
        })
        .strict()
        .optional(),
      dispatchRecommendationLeaseId: z.uuid().optional(),
      queueDeviationReason: z.string().trim().min(3).max(240).optional(),
    }),
  }),
  commandBaseSchema.extend({
    type: z.enum(["MARK_OFF_BLOCK", "MARK_ON_BLOCK"]),
    payload: z.object({ rotationId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.literal("COMPLETE_TURNAROUND"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      nextAircraftState: z.enum(["AVAILABLE", "REFUELING", "PAUSED", "INACTIVE"]),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("CANCEL_ROTATION"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_PILOT_PAUSE"),
    payload: z
      .object({
        pilotId: z.string().min(1).max(100),
        paused: z.boolean(),
        reason: z.string().trim().min(3).max(240),
        expectedReviewAt: z.iso.datetime().nullable(),
        plannedOperationId: z.uuid().optional(),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("SET_AIRCRAFT_OPERATIONAL_STATE"),
    payload: z
      .object({
        aircraftId: z.string().min(1).max(100),
        state: z.enum(["AVAILABLE", "REFUELING", "PAUSED", "INTERRUPTED", "INACTIVE"]),
        reason: z.string().trim().min(3).max(240),
        expectedReviewAt: z.iso.datetime().nullable(),
        plannedOperationId: z.uuid().optional(),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("SCHEDULE_AIRCRAFT_REFUEL"),
    payload: z
      .object({
        aircraftId: z.string().min(1).max(100),
        planned: z.boolean(),
        reason: z.string().trim().min(3).max(240),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD"),
    payload: z.object({
      aircraftId: z.string().min(1).max(100),
      reminderThreshold: z.number().int().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
      adminPin: z.string().min(4).max(32),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("REVOKE_CALL"),
    payload: z.object({ rotationId: z.string().min(1).max(100) }),
  }),
  commandBaseSchema.extend({
    type: z.literal("ABORT_ROTATION"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      reason: z.string().trim().min(3).max(240),
    }),
  }),
  commandBaseSchema.extend({
    type: z.literal("ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE"),
    payload: z.object({
      rotationId: z.string().min(1).max(100),
      expectedRotationVersion: z.number().int().nonnegative(),
      expectedAircraftVersion: z.number().int().nonnegative(),
      reason: z.string().trim().min(3).max(500),
    }),
  }),
] as const;

export type FlightCommand = z.infer<(typeof flightCommandSchemas)[number]>;
