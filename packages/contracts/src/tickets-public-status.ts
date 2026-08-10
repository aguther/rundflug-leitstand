import { z } from "zod";

import { fidsContentFilterSchema, fidsViewModeSchema } from "./event-auth";

import { gateDisplayFilterSchema, timeZoneSchema } from "./shared";

export const ticketGroupOperationalStatusSchema = z.enum([
  "QUEUED",
  "PRESENT",
  "CALLED",
  "BOARDING",
  "IN_FLIGHT",
  "LANDED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELED",
  "CLARIFICATION",
  "MISSING",
]);
export type TicketGroupOperationalStatus = z.infer<typeof ticketGroupOperationalStatusSchema>;

export const ticketGroupRecallEndReasonSchema = z.enum([
  "MANUAL",
  "PRESENT",
  "BOARDING",
  "DEFERRED",
  "NO_SHOW",
  "CANCELED",
  "EXPIRED",
]);
export type TicketGroupRecallEndReason = z.infer<typeof ticketGroupRecallEndReasonSchema>;

export const ticketGroupRecallProjectionSchema = z
  .object({
    id: z.uuid(),
    sequence: z.number().int().positive(),
    startedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    fidsMessage: z.string().min(1),
    publicMessage: z.string().min(1),
  })
  .strict();
export type TicketGroupRecallProjection = z.infer<typeof ticketGroupRecallProjectionSchema>;

export const ticketSearchRequestSchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    status: z.enum(["ACTIVE", "OPEN", "CANCELED"]).default("ACTIVE"),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(500).optional(),
    ticketGroupIds: z.array(z.string().min(1).max(100)).max(50).default([]),
    soldByOperatorAccountId: z.uuid().optional(),
  })
  .refine((value) => value.ticketGroupIds.length === 0 || !value.cursor, {
    message: "ID-Revalidierung und Cursor können nicht kombiniert werden.",
  });
export type TicketSearchRequest = z.infer<typeof ticketSearchRequestSchema>;

export const ticketSearchResultSchema = z.object({
  ticketGroupId: z.string(),
  productId: z.string(),
  productCode: z.string(),
  productName: z.string(),
  groupStatus: ticketGroupOperationalStatusSchema,
  groupSize: z.number().int().positive(),
  queueSequence: z.number().int().positive(),
  bookingGroupNumber: z.number().int().positive(),
  bookingGroupLabel: z.string(),
  standby: z.boolean(),
  soldAt: z.string(),
  soldByOperatorAccountId: z.string().nullable(),
  soldByOperatorLoginCode: z.string().nullable(),
  communicationNumber: z.number().int().positive().nullable(),
  communicationLabel: z.string().nullable(),
  communicationNumbers: z.array(z.number().int().positive()),
  communicationLabels: z.array(z.string()),
  rotationStatus: z.string().nullable(),
  rotationStatuses: z.array(z.string()),
});
export const ticketSearchResponseSchema = z.object({
  results: z.array(ticketSearchResultSchema).max(50),
  nextCursor: z.string().nullable(),
});
export type TicketSearchResult = z.infer<typeof ticketSearchResultSchema>;
export type TicketSearchResponse = z.infer<typeof ticketSearchResponseSchema>;

export const ticketGroupPrintDataSchema = z.object({
  ticketGroupId: z.string(),
  eventName: z.string(),
  productName: z.string(),
  gateLabel: z.string(),
  communicationLabel: z.string(),
  code: z.string().regex(/^[A-Z2-9]{12,32}$/),
  groupSize: z.number().int().positive(),
});
export type TicketGroupPrintData = z.infer<typeof ticketGroupPrintDataSchema>;

export const bookingGroupPartContextSchema = z
  .object({
    partNumber: z.number().int().positive(),
    partCount: z.number().int().positive(),
    passengerCount: z.number().int().positive(),
  })
  .strict();
export type BookingGroupPartContext = z.infer<typeof bookingGroupPartContextSchema>;

export const forecastStateSchema = z.enum([
  "DISPATCH_WINDOW",
  "LONG_RANGE_WINDOW",
  "AFTER_OPERATIONS_END",
  "UNAVAILABLE",
]);
export type ForecastState = z.infer<typeof forecastStateSchema>;

export const publicForecastReasonSchema = z.enum([
  "RETURN_TIME_UNKNOWN",
  "NO_MATCHING_CAPACITY",
  "STATUS_CLARIFICATION",
  "OPERATIONS_INTERRUPTED",
  "EMERGENCY_MODE",
  "RESOURCE_GROUP_UNAVAILABLE",
]);
export type PublicForecastReason = z.infer<typeof publicForecastReasonSchema>;

export const publicTicketStatusSchema = z
  .object({
    eventId: z.string(),
    eventName: z.string(),
    productName: z.string(),
    productCode: z.string(),
    publicDescription: z.string(),
    gateLabel: z.string(),
    communicationNumber: z.number().int().positive(),
    bookingGroupPart: bookingGroupPartContextSchema.nullable(),
    status: z.enum([
      "WAITING",
      "PREPARE",
      "COME_TO_FLIGHT_LINE",
      "BOARDING",
      "IN_FLIGHT",
      "LANDED",
      "COMPLETED",
      "SERVICE_PAUSED",
    ]),
    queuePosition: z.number().int().positive().nullable(),
    waitLowerMinutes: z.number().int().nonnegative(),
    waitUpperMinutes: z.number().int().nonnegative(),
    boardingWindowLowerAt: z.iso.datetime().nullable(),
    boardingWindowUpperAt: z.iso.datetime().nullable(),
    forecastState: forecastStateSchema,
    forecastReason: publicForecastReasonSchema.nullable(),
    timeZone: timeZoneSchema,
    predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
    message: z.string(),
    operationalNotice: z.string(),
    activeRecall: ticketGroupRecallProjectionSchema.nullable(),
    updatedAt: z.string(),
  })
  .strict();
export type PublicTicketStatus = z.infer<typeof publicTicketStatusSchema>;

export const publicBoardGroupSchema = z
  .object({
    productName: z.string(),
    productCode: z.string(),
    gateLabel: z.string(),
    communicationNumber: z.number().int().positive(),
    ticketLabels: z.array(z.string()).min(1),
    aircraftRegistration: z.string().nullable(),
    departedAt: z.string().nullable().optional().default(null),
    status: z.enum([
      "WAITING",
      "PREPARE",
      "COME_TO_FLIGHT_LINE",
      "BOARDING",
      "IN_FLIGHT",
      "LANDED",
      "COMPLETED",
      "SERVICE_PAUSED",
    ]),
    waitLowerMinutes: z.number().int().nonnegative(),
    waitUpperMinutes: z.number().int().nonnegative(),
    boardingWindowLowerAt: z.iso.datetime().nullable(),
    boardingWindowUpperAt: z.iso.datetime().nullable(),
    forecastState: forecastStateSchema,
    forecastReason: publicForecastReasonSchema.nullable(),
    dispatchOrder: z.number().int().positive().nullable().default(null),
    predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
    operationalNotice: z.string(),
    activeRecall: ticketGroupRecallProjectionSchema.nullable(),
  })
  .strict();
export type PublicBoardGroup = z.infer<typeof publicBoardGroupSchema>;

export const fidsBoardRowSchema = publicBoardGroupSchema
  .extend({
    rowId: z.string().min(1).max(100),
    productId: z.string().min(1).max(100),
    gateId: z.string().min(1).max(100).nullable(),
    bookingGroupLabels: z.array(z.string().min(1).max(80)).min(1).max(3).optional(),
    sharedFlightKey: z.string().min(1).max(120).nullable().optional(),
  })
  .strict();
export type FidsBoardRow = z.infer<typeof fidsBoardRowSchema>;

export const fidsFilterOptionsSchema = z
  .object({
    gates: z.array(
      z
        .object({
          id: z.string().min(1).max(100),
          label: z.string().min(1).max(160),
          active: z.boolean(),
        })
        .strict(),
    ),
    products: z.array(
      z
        .object({
          id: z.string().min(1).max(100),
          code: z.string().min(1).max(40),
          name: z.string().min(1).max(160),
          gateId: z.string().min(1).max(100),
          active: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type FidsFilterOptions = z.infer<typeof fidsFilterOptionsSchema>;

const fidsPageSchema = z
  .object({
    requestedPage: z.number().int().min(1).max(999),
    pageSize: z.number().int().min(0).max(20),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    groups: z.array(fidsBoardRowSchema),
  })
  .strict();

export const fidsBoardResponseSchema = z
  .object({
    eventName: z.string(),
    timeZone: timeZoneSchema,
    emergencyMode: z.boolean(),
    operationalInterrupted: z.boolean(),
    operationalNotice: z.string(),
    departedVisibilitySeconds: z.number().int().min(5).max(900).default(15),
    updatedAt: z.string(),
    preferencesVersion: z.number().int().nonnegative(),
    viewMode: fidsViewModeSchema,
    filterSummary: fidsContentFilterSchema,
    priority: z
      .object({
        configuredCapacity: z.number().int().min(1).max(19),
        effectiveCapacity: z.number().int().min(0).max(20),
        totalItems: z.number().int().nonnegative(),
        overflowCount: z.number().int().nonnegative(),
        groups: z.array(fidsBoardRowSchema),
      })
      .strict()
      .nullable(),
    page: fidsPageSchema,
    fleet: z.array(
      z
        .object({
          registration: z.string(),
          status: z.enum([
            "AVAILABLE",
            "BOARDING",
            "IN_FLIGHT",
            "LANDED",
            "TURNAROUND",
            "REFUELING",
            "PAUSED",
            "INTERRUPTED",
            "INACTIVE",
          ]),
          refuelPlanned: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type FidsBoardResponse = z.infer<typeof fidsBoardResponseSchema>;

export const publicBoardSchema = z.object({
  eventName: z.string(),
  timeZone: timeZoneSchema,
  selectedGate: z
    .object({ id: z.string(), label: z.string(), displayFilter: gateDisplayFilterSchema })
    .nullable(),
  emergencyMode: z.boolean(),
  operationalInterrupted: z.boolean(),
  operationalNotice: z.string(),
  departedVisibilitySeconds: z.number().int().min(5).max(900).default(15),
  updatedAt: z.string(),
  groups: z.array(publicBoardGroupSchema),
  fleet: z.array(
    z.object({
      registration: z.string(),
      status: z.enum([
        "AVAILABLE",
        "BOARDING",
        "IN_FLIGHT",
        "LANDED",
        "TURNAROUND",
        "REFUELING",
        "PAUSED",
        "INTERRUPTED",
        "INACTIVE",
      ]),
      refuelPlanned: z.boolean(),
    }),
  ),
});
export type PublicBoard = z.infer<typeof publicBoardSchema>;

const publicGroupPartSchema = bookingGroupPartContextSchema
  .extend({
    gateLabel: z.string(),
    status: z.enum([
      "WAITING",
      "PREPARE",
      "COME_TO_FLIGHT_LINE",
      "BOARDING",
      "IN_FLIGHT",
      "LANDED",
      "COMPLETED",
      "SERVICE_PAUSED",
    ]),
    queuePosition: z.number().int().positive().nullable(),
    boardingWindowLowerAt: z.iso.datetime().nullable(),
    boardingWindowUpperAt: z.iso.datetime().nullable(),
    forecastState: forecastStateSchema,
    forecastReason: publicForecastReasonSchema.nullable(),
    predictionQuality: z.enum(["STABLE", "CHANGING", "UNCERTAIN"]),
    message: z.string(),
  })
  .strict();

export const publicGroupStatusSchema = z
  .object({
    eventId: z.string(),
    eventName: z.string(),
    bookingGroupLabel: z.string(),
    groupSize: z.number().int().positive(),
    productName: z.string(),
    productCode: z.string(),
    publicDescription: z.string(),
    timeZone: timeZoneSchema,
    operationalNotice: z.string(),
    activeRecall: ticketGroupRecallProjectionSchema.nullable(),
    updatedAt: z.string(),
    parts: z.array(publicGroupPartSchema).min(1),
  })
  .strict();
export type PublicGroupStatus = z.infer<typeof publicGroupStatusSchema>;
