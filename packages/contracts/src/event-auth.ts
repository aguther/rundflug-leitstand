import { z } from "zod";

import { timeZoneSchema } from "./shared";

export const eventSnapshotSchema = z.object({
  eventId: z.string(),
  name: z.string(),
  eventDate: z.string(),
  aerodrome: z.string(),
  timeZone: timeZoneSchema,
  status: z.enum(["PREPARATION", "ACTIVE", "CLOSED", "ARCHIVED"]),
  archivedAt: z.string().nullable(),
  templateSourceId: z.string().nullable(),
  emergencyMode: z.boolean(),
  operationalInterrupted: z.boolean(),
  version: z.number().int().nonnegative(),
  operationalNote: z.string(),
  saleOpensAt: z.string().nullable(),
  operationsStartAt: z.string().nullable().default(null),
  operationsEndAt: z.string().nullable(),
  noShowAfterMinutes: z.number().int().positive(),
  maxTicketDeferrals: z.number().int().min(1).max(10),
  notificationLeadMinutes: z.number().int().positive(),
  automaticPrecallEnabled: z.boolean(),
  precallLeadMinutes: z.number().int().min(1).max(240),
  maximumGateWaitMinutes: z.number().int().min(1).max(120),
  precallMinimumQuality: z.enum(["STABLE", "CHANGING"]),
  precallGateCooldownMinutes: z.number().int().min(0).max(60),
  referenceWeightsKg: z.object({
    child: z.number().positive(),
    normal: z.number().positive(),
    heavy: z.number().positive(),
  }),
  plannedBoardingMinutes: z.number().int().positive(),
  plannedDeboardingMinutes: z.number().int().positive(),
  plannedBufferMinutes: z.number().int().nonnegative(),
  departedVisibilitySeconds: z.number().int().min(5).max(900).default(15),
  logoVariants: z
    .object({
      light: z.boolean(),
      dark: z.boolean(),
    })
    .optional(),
  updatedAt: z.string(),
});

export type EventSnapshot = z.infer<typeof eventSnapshotSchema>;

export const eventCatalogEntrySchema = z.object({
  eventId: z.string(),
  name: z.string(),
  eventDate: z.string(),
  aerodrome: z.string(),
  timeZone: timeZoneSchema,
  status: z.string(),
  archivedAt: z.string().nullable(),
  templateSourceId: z.string().nullable(),
  version: z.number().int().nonnegative(),
});
export const eventCatalogSchema = z.object({ events: z.array(eventCatalogEntrySchema) });
export type EventCatalogEntry = z.infer<typeof eventCatalogEntrySchema>;
export type EventCatalog = z.infer<typeof eventCatalogSchema>;

export const bootstrapRequestSchema = z.object({
  setupCode: z.string().min(8).max(256).optional(),
  adminPin: z.string().regex(/^\d{6,12}$/),
  eventId: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  name: z.string().trim().min(3).max(120),
  eventDate: z.iso.date(),
  aerodrome: z.string().trim().min(2).max(120),
  timeZone: timeZoneSchema.default("Europe/Berlin"),
  // Temporary development-harness compatibility. Production creates the technical origin inside
  // the Worker and never accepts it as browser-controlled authentication data.
  adminDeviceId: z.uuid().optional(),
  adminCredentialHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type BootstrapRequest = z.infer<typeof bootstrapRequestSchema>;

export const operatorRoleSchema = z.enum([
  "CASHIER",
  "FLIGHT_LINE",
  "FLIGHT_DIRECTOR",
  "ADMIN",
  "DISPLAY",
]);
export type OperatorRole = z.infer<typeof operatorRoleSchema>;

export const fidsLayoutSchema = z.enum(["SINGLE", "DOUBLE"]);
export type FidsLayout = z.infer<typeof fidsLayoutSchema>;

export const fidsThemeSchema = z.enum(["SYSTEM", "LIGHT", "DARK"]);
export type FidsTheme = z.infer<typeof fidsThemeSchema>;

export const fidsViewModeSchema = z.enum(["FIXED_PAGE", "SPLIT"]);
export type FidsViewMode = z.infer<typeof fidsViewModeSchema>;

const uniqueFidsIdsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, "FIDS filter IDs must be unique");

export const fidsContentFilterSchema = z
  .object({
    productIds: uniqueFidsIdsSchema.default([]),
    gateIds: uniqueFidsIdsSchema.default([]),
  })
  .strict();
export type FidsContentFilter = z.infer<typeof fidsContentFilterSchema>;

export const eventLogoThemeSchema = z.enum(["light", "dark"]);
export type EventLogoTheme = z.infer<typeof eventLogoThemeSchema>;

const fidsPreferencesFieldsSchema = z
  .object({
    visibleRows: z.number().int().min(4).max(20),
    layout: fidsLayoutSchema,
    theme: fidsThemeSchema,
    viewMode: fidsViewModeSchema.default("FIXED_PAGE"),
    priorityGroupCount: z.number().int().min(1).max(19).default(3),
    rotationIntervalSeconds: z.number().int().min(5).max(60).default(12),
    groupSharedFlights: z.boolean().default(false),
    contentFilter: fidsContentFilterSchema.default({ productIds: [], gateIds: [] }),
    version: z.number().int().min(0),
  })
  .strict();

export const fidsPreferencesSchema = fidsPreferencesFieldsSchema.refine(
  (preferences) => preferences.priorityGroupCount < preferences.visibleRows,
  {
    message: "Priority group count must be lower than visible rows",
    path: ["priorityGroupCount"],
  },
);
export type FidsPreferences = z.infer<typeof fidsPreferencesSchema>;

export const updateFidsPreferencesSchema = fidsPreferencesFieldsSchema
  .omit({ version: true })
  .extend({
    commandId: z.uuid(),
    expectedVersion: z.number().int().min(0),
  })
  .refine((preferences) => preferences.priorityGroupCount < preferences.visibleRows, {
    message: "Priority group count must be lower than visible rows",
    path: ["priorityGroupCount"],
  })
  .strict();
export type UpdateFidsPreferences = z.infer<typeof updateFidsPreferencesSchema>;

export const operatorAccountSummarySchema = z.object({
  id: z.uuid(),
  loginCode: z.string().regex(/^[A-Z]+-\d{2,}$/),
  role: operatorRoleSchema,
  active: z.boolean(),
});
export type OperatorAccountSummary = z.infer<typeof operatorAccountSummarySchema>;

export const operatorAccountCatalogSchema = z.object({
  accounts: z.array(operatorAccountSummarySchema.omit({ active: true })),
});
export type OperatorAccountCatalog = z.infer<typeof operatorAccountCatalogSchema>;

export const operatorLoginRequestSchema = z.object({
  accountId: z.uuid(),
  pin: z.string().regex(/^\d{6,12}$/),
  deviceId: z.uuid().optional(),
});
export type OperatorLoginRequest = z.infer<typeof operatorLoginRequestSchema>;

export const operatorSessionSchema = z.object({
  authenticated: z.literal(true),
  account: operatorAccountSummarySchema.omit({ active: true }),
});
export type OperatorSession = z.infer<typeof operatorSessionSchema>;

export const createOperatorAccountSchema = z.object({
  role: operatorRoleSchema,
  pin: z.string().regex(/^\d{6,12}$/),
});
export type CreateOperatorAccount = z.infer<typeof createOperatorAccountSchema>;

export const updateOperatorAccountSchema = z
  .object({
    active: z.boolean().optional(),
    revokeSessions: z.literal(true).optional(),
    pin: z
      .string()
      .regex(/^\d{6,12}$/)
      .optional(),
  })
  .refine(
    (value) =>
      value.active !== undefined || value.pin !== undefined || value.revokeSessions === true,
  );
export type UpdateOperatorAccount = z.infer<typeof updateOperatorAccountSchema>;

export const adminPinVerificationSchema = z.object({
  adminPin: z.string().min(4).max(32),
});
export type AdminPinVerification = z.infer<typeof adminPinVerificationSchema>;

export const adminDeviceRecoverySchema = z.object({
  adminPin: z.string().min(4).max(32),
  credentialHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type AdminDeviceRecovery = z.infer<typeof adminDeviceRecoverySchema>;

export const cloneEventRequestSchema = z.object({
  commandId: z.uuid(),
  expectedSourceVersion: z.number().int().nonnegative(),
  eventId: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  name: z.string().trim().min(3).max(120),
  eventDate: z.iso.date(),
  aerodrome: z.string().trim().min(2).max(120),
  timeZone: timeZoneSchema.default("Europe/Berlin"),
  restartMode: z.enum(["KEEP_MASTER_DATA", "EMPTY"]).default("KEEP_MASTER_DATA"),
});
export type CloneEventRequest = z.infer<typeof cloneEventRequestSchema>;

export const adminEventFlowPointSchema = z
  .object({
    at: z.iso.datetime(),
    soldTickets: z.number().int().nonnegative(),
    completedTickets: z.number().int().nonnegative(),
    openTickets: z.number().int().nonnegative(),
  })
  .strict();

export const adminEventFlowSchema = z
  .object({
    eventId: z.string(),
    from: z.iso.datetime(),
    plannedUntil: z.iso.datetime(),
    observedUntil: z.iso.datetime(),
    bucketMinutes: z.number().int().positive(),
    points: z.array(adminEventFlowPointSchema).max(96),
  })
  .strict();
export type AdminEventFlowPoint = z.infer<typeof adminEventFlowPointSchema>;
export type AdminEventFlow = z.infer<typeof adminEventFlowSchema>;
