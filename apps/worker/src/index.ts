import { APP_NAME, APP_VERSION, REQUIREMENTS_VERSION } from "@rundflug/config";
import {
  type AnalysisSnapshot,
  adminDeviceRecoverySchema,
  adminEventFlowSchema,
  adminPinVerificationSchema,
  analysisArchiveListSchema,
  analysisArchiveRequestSchema,
  analysisArchiveSchema,
  analysisSnapshotRequestSchema,
  analysisSnapshotSchema,
  bootstrapRequestSchema,
  cloneEventRequestSchema,
  createOperatorAccountSchema,
  type EventLogoTheme,
  type FactoryResetResponse,
  type FidsBoardResponse,
  type FidsBoardRow,
  type FidsFilterOptions,
  factoryResetRequestSchema,
  forecastHistoryQuerySchema,
  forecastHistorySchema,
  type GateDisplayFilter,
  gateDisplayFilterSchema,
  importMasterDataTemplateRequestSchema,
  importMasterDataTemplateResponseSchema,
  type MasterDataTemplate,
  type MasterDataTemplateCounts,
  masterDataTemplateSchema,
  masterDataTemplateValidationRequestSchema,
  masterDataTemplateValidationSchema,
  type OperationBoard,
  operationalHistoryQuerySchema,
  operationalHistorySchema,
  operationBoardSchema,
  operatorLoginRequestSchema,
  resourceDayHistoryQuerySchema,
  resourceDayHistorySchema,
  simulationPlanExportSchema,
  ticketSearchRequestSchema,
  updateOperatorAccountSchema,
} from "@rundflug/contracts";
import {
  assessForecastFreshness,
  assessMarginalProductCapacity,
  buildTicketGroupRecallCopy,
  createQueueAvailability,
  derivePublicForecastProjection,
  derivePublicRotationStatus,
  deriveResourceGroupCapacity,
  estimateDuration,
  forecastQueueWindows,
  formatBookingGroupLabel,
  formatBookingGroupPartLabel,
  formatFlightGroupLabel,
  groupSharedFidsFlights,
  orderFidsRows,
  paginateFidsRows,
  parseFidsPage,
  partitionFidsRows,
  resolveTurnaroundProfile,
} from "@rundflug/domain";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { buildAdminEventFlow, buildEventDayWindow } from "./admin-event-flow";
import {
  analysisActorAlias,
  analysisArchiveDownload,
  buildAnalysisArchive,
  deleteAnalysisArchive,
  expireAnalysisArchives,
  listAnalysisArchives,
  processPendingAnalysisArchives,
  requestAnalysisArchive,
} from "./analysis-archive";
import { buildAnalysisSnapshot } from "./analysis-snapshot";
import {
  assertRole,
  authorizeSession,
  clearedSessionCookie,
  nextLoginCode,
  type OperatorRole,
  type SessionActor,
  sessionBrowserBindingHash,
  sessionCookie,
  sessionTimes,
} from "./auth";
import { createPortableBackup, operationDateInTimeZone } from "./backup";
import {
  bookingGroupPartContextFromColumns,
  withBookingGroupPartProjection,
} from "./booking-group-part-projection";
import { hashPin, randomToken, sha256Hex, verifyCredential, verifyPin } from "./crypto";
import { runD1ReadsSequentially } from "./d1-read-scheduler";
import { dailyReportCsv, dailyReportPdfLines, loadDailyReport } from "./daily-report";
import { EventCoordinator } from "./event-coordinator";
import {
  type EventDeletionResponse,
  eventDeletionStatements,
  finishEventDeletionAssetCleanup,
} from "./event-deletion";
import {
  eventLogoExtension,
  parseEventLogoTheme,
  readEventLogoBytes,
  validateEventLogo,
} from "./event-logo";
import {
  clearFactoryResetCoordinators,
  factoryResetRequestHash,
  factoryResetStatements,
  finishR2Cleanup,
} from "./factory-reset";
import { mayAccessFids } from "./fids-authorization";
import {
  type FidsProjectionEvent,
  type FidsProjectionFilter,
  type FidsProjectionRow,
  loadAllFidsProjectionRows,
  loadFidsProjectionEvent,
  loadFidsProjectionFleet,
  loadFidsProjectionRows,
} from "./fids-board-projection";
import { loadFidsPreferences } from "./fids-preferences-storage";
import { buildForecastHistoryStatement } from "./forecast-history";
import {
  EMPTY_GATE_DISPLAY_FILTER_JSON,
  withGateDisplayFilterFallback,
} from "./gate-display-filter-storage";
import { loadMasterDataExportProjection } from "./master-data-export";
import { buildOperationalHistoryStatement } from "./operational-history";
import {
  allowAdminDeviceRecoveryAttempt,
  allowLoginAttempt,
  allowSetupAttempt,
  allowUnknownTicketAttempt,
} from "./public-access";
import { registerPublicInstallRoutes } from "./public-install-routes";
import { PUBLIC_STATUS_MESSAGES, publicServicePausedMessage } from "./public-status-copy";
import { createCsv, createTextPdf } from "./report";
import {
  API_BODY_LIMIT_BYTES,
  limitApiBody,
  requireValidJsonBody,
} from "./request-body-boundaries";
import {
  clearedResetSetupCookie,
  installationRecoveryCode,
  resetSetupCookie,
  resetSetupGrantExpiry,
  resetSetupToken,
  validResetSetupGrant,
} from "./reset-setup-grant";
import {
  buildAircraftBlockStatement,
  buildPilotPauseEventStatement,
  buildResourceDayRotationStatement,
  pairPilotPauseEvents,
} from "./resource-day-history";
import { rowToSnapshot } from "./snapshot";
import { ticketSearchStatusCondition } from "./ticket-search";
import { httpsRedirectLocation } from "./transport-security";
import type { Env, StoredEventRow } from "./types";
import {
  isAllowedPushEndpoint,
  purgeExpiredPushSubscriptions,
  pushDeleteAfter,
  pushRetentionDays,
  queueEligiblePreparationNotifications,
  vapidConfiguration,
} from "./web-push";

const app = new Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>();

function eventRoutes<const Suffix extends string>(
  suffix: Suffix,
): [`/api/control/:eventId${Suffix}`] {
  const controlPath = `/api/control/:eventId${suffix}` as `/api/control/:eventId${Suffix}`;
  return [controlPath];
}

interface TicketSearchCursor {
  soldAt: string;
  id: string;
}

interface ActiveTicketGroupRecallColumns {
  recall_id: string | null;
  recall_sequence: number | null;
  recall_started_at: string | null;
  recall_expires_at: string | null;
  product_code: string;
  communication_number: number;
  gate_label: string;
}

function activeTicketGroupRecallProjection(row: ActiveTicketGroupRecallColumns) {
  if (
    !row.recall_id ||
    row.recall_sequence === null ||
    !row.recall_started_at ||
    !row.recall_expires_at
  ) {
    return null;
  }
  const copy = buildTicketGroupRecallCopy({
    communicationLabel: formatBookingGroupLabel(row.product_code, row.communication_number),
    gateLabel: row.gate_label,
  });
  return {
    id: row.recall_id,
    sequence: row.recall_sequence,
    startedAt: row.recall_started_at,
    expiresAt: row.recall_expires_at,
    fidsMessage: copy.fids,
    publicMessage: copy.publicStatus,
  };
}

function encodeTicketSearchCursor(cursor: TicketSearchCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeTicketSearchCursor(value: string | undefined): TicketSearchCursor | null {
  if (!value) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as {
      soldAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.soldAt !== "string" ||
      Number.isNaN(Date.parse(parsed.soldAt)) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      parsed.id.length > 100
    ) {
      return null;
    }
    return { soldAt: parsed.soldAt, id: parsed.id };
  } catch {
    return null;
  }
}

const MASTER_DATA_TEMPLATE_BODY_LIMIT_BYTES = API_BODY_LIMIT_BYTES;

function masterDataTemplateCounts(template: MasterDataTemplate): MasterDataTemplateCounts {
  return {
    gates: template.gates.length,
    resourceGroups: template.resourceGroups.length,
    aircraft: template.aircraft.length,
    assignments: template.assignments.length,
    pilots: template.pilots.length,
    products: template.products.length,
  };
}

function parseGateDisplayFilterJson(value: string): GateDisplayFilter {
  try {
    const parsed = gateDisplayFilterSchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // A malformed legacy filter is exported as an empty, valid filter.
  }
  return { productIds: [], rotationStatuses: [] };
}

async function boundedJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MASTER_DATA_TEMPLATE_BODY_LIMIT_BYTES) {
    throw new Error("TEMPLATE_TOO_LARGE");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MASTER_DATA_TEMPLATE_BODY_LIMIT_BYTES) {
    throw new Error("TEMPLATE_TOO_LARGE");
  }
  return JSON.parse(text);
}

interface MasterDataTemplateTargetRow {
  status: string;
  version: number;
  gates: number;
  resource_groups: number;
  memberships: number;
  pilots: number;
  products: number;
}

function templateTargetEligible(target: MasterDataTemplateTargetRow | null): boolean {
  return Boolean(
    target &&
      target.status === "PREPARATION" &&
      target.gates === 0 &&
      target.resource_groups === 0 &&
      target.memberships === 0 &&
      target.pilots === 0 &&
      target.products === 0,
  );
}

async function loadTemplateTarget(
  database: D1Database,
  eventId: string,
): Promise<MasterDataTemplateTargetRow | null> {
  return database
    .prepare(
      `SELECT od.status, od.version,
              (SELECT COUNT(*) FROM gates WHERE operation_day_id = od.id) AS gates,
              (SELECT COUNT(*) FROM resource_groups WHERE operation_day_id = od.id) AS resource_groups,
              (SELECT COUNT(*) FROM resource_group_memberships
                WHERE operation_day_id = od.id AND active_until IS NULL) AS memberships,
              (SELECT COUNT(*) FROM pilots WHERE operation_day_id = od.id) AS pilots,
              (SELECT COUNT(*) FROM products WHERE operation_day_id = od.id) AS products
         FROM operation_days od WHERE od.id = ?1`,
    )
    .bind(eventId)
    .first<MasterDataTemplateTargetRow>();
}

interface ExistingTemplateAircraftRow {
  id: string;
  registration: string;
  aircraft_type: string;
  passenger_seats: number;
  maximum_passenger_payload_kg: number | null;
  refuel_reminder_threshold: number;
}

async function validateTemplateAircraft(
  database: D1Database,
  template: MasterDataTemplate,
): Promise<{
  existingByRegistration: Map<string, ExistingTemplateAircraftRow>;
  errors: Array<{ path: string; message: string }>;
}> {
  const existingByRegistration = new Map<string, ExistingTemplateAircraftRow>();
  const errors: Array<{ path: string; message: string }> = [];
  for (const [index, aircraft] of template.aircraft.entries()) {
    const existing = await database
      .prepare(
        `SELECT id, registration, aircraft_type, passenger_seats,
                maximum_passenger_payload_kg, refuel_reminder_threshold
           FROM aircraft WHERE registration = ?1`,
      )
      .bind(aircraft.registration)
      .first<ExistingTemplateAircraftRow>();
    if (!existing) continue;
    existingByRegistration.set(existing.registration, existing);
    if (
      existing.aircraft_type !== aircraft.aircraftType ||
      existing.passenger_seats !== aircraft.passengerSeats ||
      existing.maximum_passenger_payload_kg !== aircraft.maximumPassengerPayloadKg ||
      existing.refuel_reminder_threshold !== aircraft.refuelReminderThreshold
    ) {
      errors.push({
        path: `aircraft.${index}`,
        message: `Flugzeug ${aircraft.registration} existiert bereits mit abweichenden Stammdaten.`,
      });
    }
  }
  return { existingByRegistration, errors };
}

function predictedBoardingWindow(input: {
  status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
  quality: "STABLE" | "CHANGING" | "UNCERTAIN";
  predictedBoardingAt: string | null;
  lowerMinutes: number;
  upperMinutes: number;
  referenceAt: string;
}): { lowerAt: string | null; upperAt: string | null } {
  if (input.status !== "DRAFT" || input.quality === "UNCERTAIN") {
    return { lowerAt: null, upperAt: null };
  }
  const referenceMs = Date.parse(input.referenceAt);
  const storedCenterMs = input.predictedBoardingAt
    ? Date.parse(input.predictedBoardingAt)
    : Number.NaN;
  const midpointMinutes = (input.lowerMinutes + input.upperMinutes) / 2;
  const lowerMs = Number.isFinite(storedCenterMs)
    ? storedCenterMs + (input.lowerMinutes - midpointMinutes) * 60_000
    : referenceMs + input.lowerMinutes * 60_000;
  const upperMs = Number.isFinite(storedCenterMs)
    ? storedCenterMs + (input.upperMinutes - midpointMinutes) * 60_000
    : referenceMs + input.upperMinutes * 60_000;
  return {
    lowerAt: new Date(lowerMs).toISOString(),
    upperAt: new Date(Math.max(lowerMs, upperMs)).toISOString(),
  };
}

function mapFidsProjectionRow(
  row: FidsProjectionRow,
  event: FidsProjectionEvent,
  boardReadAt: string,
): FidsBoardRow {
  const forecastFreshness = assessForecastFreshness({
    predictionQuality: row.prediction_quality,
    predictionUpdatedAt: row.prediction_updated_at,
    now: boardReadAt,
  });
  const predictionQuality =
    event.operational_interrupted === 1 ||
    row.resource_group_status === "INTERRUPTED" ||
    row.resource_group_status === "ENDED"
      ? "UNCERTAIN"
      : forecastFreshness.quality;
  const waitLowerMinutes = row.prediction_lower_minutes ?? row.projection_index * 20;
  const waitUpperMinutes = row.prediction_upper_minutes ?? (row.projection_index + 1) * 30;
  const boardingWindow = predictedBoardingWindow({
    status: row.status,
    quality: predictionQuality,
    predictedBoardingAt: row.predicted_boarding_at,
    lowerMinutes: waitLowerMinutes,
    upperMinutes: waitUpperMinutes,
    referenceAt: boardReadAt,
  });
  const publicForecast = derivePublicForecastProjection({
    rotationStatus: row.status,
    predictionQuality,
    predictedBoardingAt: row.predicted_boarding_at,
    predictedCompletionAt: row.predicted_completion_at,
    operationsEndAt: event.operations_end_at,
    dispatchBatchId: row.dispatch_batch_id,
    dispatchUnplannedReason: row.dispatch_unplanned_reason,
    emergencyMode: event.emergency_mode === 1,
    operationalInterrupted: event.operational_interrupted === 1,
    resourceGroupStatus: row.resource_group_status,
  });
  const publishesWindow =
    publicForecast.forecastState === "DISPATCH_WINDOW" ||
    publicForecast.forecastState === "LONG_RANGE_WINDOW";
  const activeRecall = activeTicketGroupRecallProjection(row);
  const bookingGroupPart = bookingGroupPartContextFromColumns(row);
  const bookingGroupLabel = bookingGroupPart
    ? formatBookingGroupPartLabel(row.product_code, row.communication_number, bookingGroupPart)
    : formatBookingGroupLabel(row.product_code, row.communication_number);
  const status: FidsBoardRow["status"] =
    row.resource_group_status !== "ACTIVE"
      ? "SERVICE_PAUSED"
      : derivePublicRotationStatus({
          rotationState: row.status,
          draftStatus:
            row.precalled_at !== null
              ? "COME_TO_FLIGHT_LINE"
              : row.precall_decision_status === "PREPARE" && predictionQuality !== "UNCERTAIN"
                ? "PREPARE"
                : "WAITING",
        });
  return {
    rowId: row.row_id,
    productId: row.product_id,
    gateId: row.gate_id,
    productName: row.product_name,
    productCode: row.product_code,
    gateLabel: row.gate_label,
    communicationNumber: row.communication_number,
    bookingGroupLabels: [bookingGroupLabel],
    ticketLabels: Array.from(
      { length: Math.max(1, row.ticket_count) },
      (_, ticketIndex) =>
        `${formatBookingGroupLabel(row.product_code, row.communication_number)}/${ticketIndex + 1}`,
    ),
    aircraftRegistration: row.aircraft_registration,
    departedAt: row.departed_at,
    status,
    sharedFlightKey:
      activeRecall !== null
        ? null
        : status === "COME_TO_FLIGHT_LINE" && row.dispatch_batch_id
          ? `dispatch:${row.dispatch_batch_id}`
          : ["BOARDING", "IN_FLIGHT", "LANDED", "COMPLETED"].includes(status)
            ? `rotation:${row.rotation_id}`
            : null,
    waitLowerMinutes: publishesWindow ? waitLowerMinutes : 0,
    waitUpperMinutes: publishesWindow ? waitUpperMinutes : 0,
    boardingWindowLowerAt: publishesWindow ? boardingWindow.lowerAt : null,
    boardingWindowUpperAt: publishesWindow ? boardingWindow.upperAt : null,
    ...publicForecast,
    predictionQuality,
    dispatchOrder: row.dispatch_order,
    operationalNotice: row.planned_public_note || row.resource_group_operational_note,
    activeRecall,
  };
}

app.use("*", async (context, next) => {
  const redirectLocation = httpsRedirectLocation(context.req.url, context.env.APP_ENV);
  if (redirectLocation) return context.redirect(redirectLocation, 308);
  await next();
});

async function unknownTicketResponse(env: Env, request: Request): Promise<Response> {
  if (!(await allowUnknownTicketAttempt(env.PUBLIC_TICKET_RATE_LIMITER, request))) {
    return Response.json(
      { error: { code: "TOO_MANY_TICKET_ATTEMPTS", message: "Bitte später erneut versuchen." } },
      { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } },
    );
  }
  return Response.json(
    { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

async function authorizeDevice(
  env: Env,
  eventId: string,
  request: Request,
  preauthorizedActor?: SessionActor | null,
): Promise<{
  id: string;
  role: OperatorRole;
  accountId: string | null;
  loginCode: string | null;
} | null> {
  const actor =
    preauthorizedActor === undefined ? await authorizeSession(env, request) : preauthorizedActor;
  if (actor) {
    return {
      id: actor.deviceId,
      role: actor.role,
      accountId: actor.accountId,
      loginCode: actor.loginCode,
    };
  }
  // Production authorization is session-only. Legacy device credentials remain available solely
  // to the synthetic local integration harness until those fixtures are migrated.
  if (env.APP_ENV !== "development") return null;
  const deviceId = request.headers.get("x-device-id") ?? undefined;
  const token = request.headers.get("x-device-token") ?? undefined;
  if (!deviceId) return null;
  const device = await env.DB.prepare(
    "SELECT role, credential_hash FROM paired_devices WHERE id = ?1 AND operation_day_id = ?2 AND active = 1",
  )
    .bind(deviceId, eventId)
    .first<{ role: OperatorRole; credential_hash: string | null }>();
  if (!device || !(await verifyCredential(token ?? null, device.credential_hash))) return null;
  await env.DB.prepare("UPDATE paired_devices SET last_seen_at = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), deviceId)
    .run();
  return { id: deviceId, role: device.role, accountId: null, loginCode: null };
}

interface EventLogoRow {
  version: number;
  logo_object_key: string | null;
  logo_media_type: string | null;
  logo_dark_object_key: string | null;
  logo_dark_media_type: string | null;
}

interface EventLogoReceipt {
  operation_day_id: string;
  device_id: string;
  command_type: string;
  response_json: string;
}

function eventLogoColumns(theme: EventLogoTheme): {
  key: "logo_object_key" | "logo_dark_object_key";
  mediaType: "logo_media_type" | "logo_dark_media_type";
} {
  return theme === "dark"
    ? { key: "logo_dark_object_key", mediaType: "logo_dark_media_type" }
    : { key: "logo_object_key", mediaType: "logo_media_type" };
}

function eventLogoCommandType(operation: "SET" | "REMOVE", theme: EventLogoTheme): string {
  return `${operation}_EVENT_LOGO_${theme.toUpperCase()}`;
}

function eventLogoReceiptMatches(
  receipt: EventLogoReceipt,
  input: {
    eventId: string;
    deviceId: string;
    commandType: string;
    theme: EventLogoTheme;
    operation: "SET" | "REMOVE";
  },
): boolean {
  if (receipt.operation_day_id !== input.eventId || receipt.device_id !== input.deviceId) {
    return false;
  }
  if (receipt.command_type === input.commandType) return true;
  const legacyCommandType = input.operation === "SET" ? "SET_EVENT_LOGO" : "REMOVE_EVENT_LOGO";
  return input.theme === "light" && receipt.command_type === legacyCommandType;
}

async function findEventLogoReceipt(env: Env, commandId: string): Promise<EventLogoReceipt | null> {
  return env.DB.prepare(
    `SELECT operation_day_id, device_id, command_type, response_json
       FROM idempotency_receipts
      WHERE command_id = ?1`,
  )
    .bind(commandId)
    .first<EventLogoReceipt>();
}

function eventCoordinatorNamespace(env: Env): Env["EVENT_COORDINATOR"] {
  // workerd/miniflare does not implement jurisdiction restrictions locally.
  // Acceptance and production always request the EU jurisdiction explicitly.
  return env.APP_ENV === "development"
    ? env.EVENT_COORDINATOR
    : env.EVENT_COORDINATOR.jurisdiction("eu");
}

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: "no-referrer",
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
  }),
);

app.use("/api/*", async (context, next) => {
  await next();
  context.header("cache-control", "no-store");
});

app.use("/api/*", limitApiBody);
app.use("/api/*", requireValidJsonBody);

for (const protectedPrefix of ["/api/control/*"] as const) {
  app.use(protectedPrefix, async (context, next) => {
    if (context.req.path.includes("/fids/")) {
      await next();
      return;
    }
    const actor = await authorizeSession(context.env, context.req.raw);
    context.set("sessionActor", actor);
    if (actor?.role === "DISPLAY") {
      return context.json(
        {
          error: {
            code: "SESSION_NOT_AUTHORIZED",
            message: "Display-Konten dürfen ausschließlich die FIDS-Anzeige verwenden.",
          },
        },
        403,
      );
    }
    await next();
  });
}

app.get("/api/health", (context) =>
  context.json({
    ok: true,
    service: APP_NAME,
    applicationVersion: APP_VERSION,
    environment: context.env.APP_ENV,
    requirementsVersion: REQUIREMENTS_VERSION,
    timestamp: new Date().toISOString(),
  }),
);

app.get("/api/meta", (context) =>
  context.json({
    applicationVersion: APP_VERSION,
    architecture: "Cloudflare Worker + Static Assets + D1 + Durable Object + R2",
    dataJurisdiction: context.env.DATA_JURISDICTION,
    productionReady: false,
    requirementsVersion: REQUIREMENTS_VERSION,
    sourceRevision: context.env.SOURCE_REVISION?.trim() || "unknown",
  }),
);

app.get("/api/setup/status", async (context) => {
  const state = await context.env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM app_bootstrap) AS completed,
      (SELECT COUNT(*) FROM operation_days) AS events,
      (SELECT COUNT(*) FROM operator_accounts
        WHERE role = 'ADMIN' AND active = 1 AND deleted_at IS NULL) AS admins`,
  ).first<{ completed: number; events: number; admins: number }>();
  const resetGrant = await validResetSetupGrant(context.env, context.req.raw);
  return context.json({
    setupRequired:
      (state?.completed ?? 0) === 0 && (state?.events ?? 0) === 0 && (state?.admins ?? 0) === 0,
    setupConfigured: Boolean(installationRecoveryCode(context.env) || resetGrant),
    resetSetupAuthorized: Boolean(resetGrant),
    resetSetupExpiresAt: resetGrant?.setup_grant_expires_at ?? null,
  });
});

app.post("/api/setup", async (context) => {
  const parsed = bootstrapRequestSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json(
      { error: { code: "INVALID_SETUP", message: "Einrichtungsdaten sind unvollständig." } },
      400,
    );
  }
  const state = await context.env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM app_bootstrap) AS completed,
      (SELECT COUNT(*) FROM operation_days) AS events,
      (SELECT COUNT(*) FROM operator_accounts
        WHERE role = 'ADMIN' AND active = 1 AND deleted_at IS NULL) AS admins`,
  ).first<{ completed: number; events: number; admins: number }>();
  if ((state?.completed ?? 0) > 0 || (state?.events ?? 0) > 0 || (state?.admins ?? 0) > 0) {
    return context.json(
      { error: { code: "SETUP_ALREADY_COMPLETED", message: "Ersteinrichtung ist abgeschlossen." } },
      409,
    );
  }
  const resetGrant = await validResetSetupGrant(context.env, context.req.raw);
  const recoveryCode = installationRecoveryCode(context.env);
  if (!resetGrant && !recoveryCode) {
    return context.json(
      {
        error: {
          code: "SETUP_NOT_CONFIGURED",
          message: "Ersteinrichtung ist serverseitig noch nicht freigeschaltet.",
        },
      },
      503,
    );
  }
  if (
    !resetGrant &&
    !(await allowSetupAttempt(context.env.ADMIN_RECOVERY_RATE_LIMITER, context.req.raw))
  ) {
    return context.json(
      { error: { code: "SETUP_CREDENTIALS_INVALID", message: "Einrichtung nicht autorisiert." } },
      429,
      { "retry-after": "60" },
    );
  }
  const recoveryCodeHash = recoveryCode ? await sha256Hex(recoveryCode) : null;
  if (!resetGrant && !(await verifyCredential(parsed.data.setupCode ?? null, recoveryCodeHash))) {
    return context.json(
      { error: { code: "SETUP_CREDENTIALS_INVALID", message: "Einrichtung nicht autorisiert." } },
      403,
    );
  }
  const input = parsed.data;
  const now = new Date().toISOString();
  const adminDeviceId =
    context.env.APP_ENV === "development" && input.adminDeviceId
      ? input.adminDeviceId
      : crypto.randomUUID();
  const adminCredentialHash =
    context.env.APP_ENV === "development" ? (input.adminCredentialHash ?? null) : null;
  const adminAccountId = crypto.randomUUID();
  const adminPinHash = await hashPin(input.adminPin);
  try {
    const statements = [
      context.env.DB.prepare(
        `INSERT INTO operation_days
          (id, name, event_date, time_zone, status, emergency_mode, operational_note, version,
           created_at, updated_at, operations_end_at, operational_interrupted, sale_opens_at,
           no_show_after_minutes, notification_lead_minutes, child_reference_weight_kg,
           normal_reference_weight_kg, heavy_reference_weight_kg, planned_boarding_minutes,
           planned_deboarding_minutes, planned_buffer_minutes, aerodrome)
         VALUES (?1, ?2, ?3, ?4, 'PREPARATION', 0, '', 0, ?5, ?5, NULL, 0, NULL,
           10, 15, 35, 80, 110, 8, 5, 3, ?6)`,
      ).bind(input.eventId, input.name, input.eventDate, input.timeZone, now, input.aerodrome),
      context.env.DB.prepare(
        `INSERT INTO paired_devices
          (id, operation_day_id, label, role, active, paired_at, last_seen_at, credential_hash)
         VALUES (?1, ?2, 'Erste Administrationssitzung', 'ADMIN', 1, ?3, ?3, ?4)`,
      ).bind(adminDeviceId, input.eventId, now, adminCredentialHash),
      context.env.DB.prepare(
        `INSERT INTO operator_accounts
          (id, login_code, role, pin_hash, active, failed_attempts, session_version,
           created_at, updated_at)
         VALUES (?1, 'ADMIN-01', 'ADMIN', ?2, 1, 0, 1, ?3, ?3)`,
      ).bind(adminAccountId, adminPinHash, now),
      context.env.DB.prepare(
        `INSERT INTO app_bootstrap (singleton, operation_day_id, admin_device_id, completed_at)
         VALUES (1, ?1, ?2, ?3)`,
      ).bind(input.eventId, adminDeviceId, now),
      context.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'SYSTEM_BOOTSTRAPPED', ?3, ?4, 'OPERATION_DAY', ?2, 0, ?5)`,
      ).bind(
        crypto.randomUUID(),
        input.eventId,
        now,
        adminDeviceId,
        JSON.stringify({ anonymousAdministration: true }),
      ),
      context.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         VALUES (?1, ?2, 'SYSTEM_BOOTSTRAPPED', ?3, ?4)`,
      ).bind(crypto.randomUUID(), input.eventId, JSON.stringify({ eventId: input.eventId }), now),
    ];
    if (resetGrant) {
      statements.push(
        context.env.DB.prepare(
          `UPDATE system_reset_receipts
              SET setup_grant_used_at = ?1
            WHERE command_id = ?2
              AND setup_grant_used_at IS NULL
              AND setup_grant_expires_at > ?1`,
        ).bind(now, resetGrant.command_id),
      );
    }
    await context.env.DB.batch(statements);
  } catch {
    return context.json(
      { error: { code: "SETUP_ALREADY_COMPLETED", message: "Ersteinrichtung ist abgeschlossen." } },
      409,
    );
  }
  context.header("set-cookie", clearedResetSetupCookie(context.req.raw));
  context.header("set-cookie", clearedSessionCookie(context.req.raw), { append: true });
  return context.json(
    {
      eventId: input.eventId,
      ...(context.env.APP_ENV === "development" ? { adminDeviceId } : {}),
    },
    201,
  );
});

const LOGIN_ERROR = {
  error: { code: "LOGIN_FAILED", message: "Konto oder PIN ist nicht gültig." },
};

app.get("/api/auth/accounts", async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT id, login_code, role FROM operator_accounts
      WHERE active = 1 AND deleted_at IS NULL ORDER BY role, login_code`,
  ).all<{ id: string; login_code: string; role: OperatorRole }>();
  return context.json({
    accounts: rows.results.map((row) => ({
      id: row.id,
      loginCode: row.login_code,
      role: row.role,
    })),
  });
});

app.post("/api/auth/login", async (context) => {
  const parsed = operatorLoginRequestSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json(LOGIN_ERROR, 401);
  const { accountId, pin } = parsed.data;
  const deviceId =
    context.env.APP_ENV === "development" && parsed.data.deviceId
      ? parsed.data.deviceId
      : crypto.randomUUID();
  if (
    !(await allowLoginAttempt(context.env.ADMIN_RECOVERY_RATE_LIMITER, context.req.raw, accountId))
  ) {
    return context.json(LOGIN_ERROR, 429, { "retry-after": "60" });
  }

  const now = new Date();
  const account = await context.env.DB.prepare(
    `SELECT id, login_code, role, pin_hash, active, failed_attempts, locked_until, session_version
       FROM operator_accounts WHERE id = ?1 AND deleted_at IS NULL`,
  )
    .bind(accountId)
    .first<{
      id: string;
      login_code: string;
      role: OperatorRole;
      pin_hash: string;
      active: number;
      failed_attempts: number;
      locked_until: string | null;
      session_version: number;
    }>();
  const locked = account?.locked_until && Date.parse(account.locked_until) > now.getTime();
  const valid =
    Boolean(account?.active) &&
    !locked &&
    Boolean(account && (await verifyPin(pin, account.pin_hash)));
  if (!account || !valid) {
    if (account && !locked) {
      const failedAttempts = account.failed_attempts + 1;
      const lockedUntil =
        failedAttempts >= 5 ? new Date(now.getTime() + 15 * 60_000).toISOString() : null;
      await context.env.DB.prepare(
        `UPDATE operator_accounts
            SET failed_attempts = ?1, locked_until = ?2, updated_at = ?3
          WHERE id = ?4`,
      )
        .bind(failedAttempts >= 5 ? 0 : failedAttempts, lockedUntil, now.toISOString(), account.id)
        .run();
    }
    return context.json(LOGIN_ERROR, 401);
  }

  const sessionId = crypto.randomUUID();
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const times = sessionTimes(account.role, now);
  const activeEvent = await context.env.DB.prepare(
    `SELECT id FROM operation_days
      ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PREPARATION' THEN 1 ELSE 2 END,
               event_date DESC LIMIT 1`,
  ).first<{ id: string }>();
  const statements = [
    context.env.DB.prepare(
      `UPDATE operator_accounts
          SET failed_attempts = 0, locked_until = NULL, updated_at = ?1 WHERE id = ?2`,
    ).bind(times.createdAt, account.id),
    context.env.DB.prepare(
      `INSERT INTO operator_sessions
        (id, account_id, session_version, token_hash, device_id, created_at, last_seen_at,
         idle_expires_at, absolute_expires_at, revoked_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8, NULL)`,
    ).bind(
      sessionId,
      account.id,
      account.session_version,
      tokenHash,
      deviceId,
      times.createdAt,
      times.idleExpiresAt,
      times.absoluteExpiresAt,
    ),
  ];
  if (activeEvent) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO paired_devices
          (id, operation_day_id, label, role, active, paired_at, last_seen_at, credential_hash)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, NULL)
         ON CONFLICT(id) DO UPDATE SET
           operation_day_id = excluded.operation_day_id,
           label = excluded.label,
           role = excluded.role,
           active = 1,
           last_seen_at = excluded.last_seen_at,
           revoked_at = NULL,
           credential_hash = NULL`,
      ).bind(
        deviceId,
        activeEvent.id,
        `${account.login_code} · Sitzung`,
        account.role,
        times.createdAt,
      ),
    );
  }
  await context.env.DB.batch(statements);
  context.header("set-cookie", sessionCookie(token, context.req.raw, times.maxAgeSeconds));
  return context.json({
    authenticated: true,
    account: { id: account.id, loginCode: account.login_code, role: account.role },
  });
});

app.get("/api/auth/session", async (context) => {
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor) {
    return context.json(
      { error: { code: "SESSION_REQUIRED", message: "Anmeldung erforderlich." } },
      401,
    );
  }
  return context.json({
    authenticated: true,
    account: { id: actor.accountId, loginCode: actor.loginCode, role: actor.role },
  });
});

app.get("/api/auth/events", async (context) => {
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor) {
    return context.json(
      { error: { code: "SESSION_REQUIRED", message: "Anmeldung erforderlich." } },
      401,
    );
  }
  const rows = await context.env.DB.prepare(
    `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at,
            template_source_id, version
       FROM operation_days
      WHERE archived_at IS NULL
      ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PREPARATION' THEN 1 ELSE 2 END,
               event_date DESC, name`,
  ).all<{
    id: string;
    name: string;
    event_date: string;
    aerodrome: string;
    time_zone: string;
    status: string;
    archived_at: string | null;
    template_source_id: string | null;
    version: number;
  }>();
  return context.json({
    events: rows.results.map((row) => ({
      eventId: row.id,
      name: row.name,
      eventDate: row.event_date,
      aerodrome: row.aerodrome,
      timeZone: row.time_zone,
      status: row.status,
      archivedAt: row.archived_at,
      templateSourceId: row.template_source_id,
      version: row.version,
    })),
  });
});

app.post("/api/auth/logout", async (context) => {
  const actor = await authorizeSession(context.env, context.req.raw);
  if (actor) {
    await context.env.DB.prepare(
      "UPDATE operator_sessions SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL",
    )
      .bind(new Date().toISOString(), actor.sessionId)
      .run();
  }
  context.header("set-cookie", clearedSessionCookie(context.req.raw));
  return context.body(null, 204);
});

app.get("/api/admin/operator-accounts", async (context) => {
  const actor = assertRole(await authorizeSession(context.env, context.req.raw), ["ADMIN"]);
  if (!actor)
    return context.json({ error: { code: "FORBIDDEN", message: "Nicht autorisiert." } }, 403);
  const rows = await context.env.DB.prepare(
    `SELECT id, login_code, role, active FROM operator_accounts
      WHERE deleted_at IS NULL ORDER BY role, login_code`,
  ).all<{ id: string; login_code: string; role: OperatorRole; active: number }>();
  return context.json({
    accounts: rows.results.map((row) => ({
      id: row.id,
      loginCode: row.login_code,
      role: row.role,
      active: row.active === 1,
    })),
  });
});

app.post("/api/admin/operator-accounts", async (context) => {
  const actor = assertRole(await authorizeSession(context.env, context.req.raw), ["ADMIN"]);
  if (!actor)
    return context.json({ error: { code: "FORBIDDEN", message: "Nicht autorisiert." } }, 403);
  const parsed = createOperatorAccountSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json(
      { error: { code: "INVALID_ACCOUNT", message: "Kontodaten sind ungültig." } },
      400,
    );
  }
  const id = crypto.randomUUID();
  const loginCode = await nextLoginCode(context.env, parsed.data.role);
  const pinHash = await hashPin(parsed.data.pin);
  const now = new Date().toISOString();
  await context.env.DB.prepare(
    `INSERT INTO operator_accounts
      (id, login_code, role, pin_hash, active, failed_attempts, session_version, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 1, 0, 1, ?5, ?5)`,
  )
    .bind(id, loginCode, parsed.data.role, pinHash, now)
    .run();
  return context.json({ id, loginCode, role: parsed.data.role, active: true }, 201);
});

app.patch("/api/admin/operator-accounts/:accountId", async (context) => {
  const actor = assertRole(await authorizeSession(context.env, context.req.raw), ["ADMIN"]);
  if (!actor)
    return context.json({ error: { code: "FORBIDDEN", message: "Nicht autorisiert." } }, 403);
  const parsed = updateOperatorAccountSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json(
      { error: { code: "INVALID_ACCOUNT", message: "Kontodaten sind ungültig." } },
      400,
    );
  }
  const accountId = context.req.param("accountId");
  if (accountId === actor.accountId && parsed.data.active === false) {
    return context.json(
      { error: { code: "ACTIVE_SESSION_REQUIRED", message: "Das eigene Konto bleibt aktiv." } },
      409,
    );
  }
  const pinHash = parsed.data.pin ? await hashPin(parsed.data.pin) : null;
  const now = new Date().toISOString();
  const result = await context.env.DB.prepare(
    `UPDATE operator_accounts
        SET active = COALESCE(?1, active), pin_hash = COALESCE(?2, pin_hash),
            session_version = CASE
              WHEN ?1 = 0 OR ?2 IS NOT NULL OR ?5 = 1 THEN session_version + 1
              ELSE session_version
            END,
            failed_attempts = 0, locked_until = NULL, updated_at = ?3
      WHERE id = ?4 AND deleted_at IS NULL`,
  )
    .bind(
      parsed.data.active === undefined ? null : parsed.data.active ? 1 : 0,
      pinHash,
      now,
      accountId,
      parsed.data.revokeSessions ? 1 : 0,
    )
    .run();
  if (!result.meta.changes) {
    return context.json(
      { error: { code: "ACCOUNT_NOT_FOUND", message: "Konto nicht gefunden." } },
      404,
    );
  }
  return context.json({ updated: true });
});

app.delete("/api/admin/operator-accounts/:accountId", async (context) => {
  const actor = assertRole(await authorizeSession(context.env, context.req.raw), ["ADMIN"]);
  if (!actor)
    return context.json({ error: { code: "FORBIDDEN", message: "Nicht autorisiert." } }, 403);
  const accountId = context.req.param("accountId");
  if (accountId === actor.accountId) {
    return context.json(
      {
        error: {
          code: "ACTIVE_SESSION_REQUIRED",
          message: "Das aktuell verwendete eigene Konto kann nicht gelöscht werden.",
        },
      },
      409,
    );
  }
  const now = new Date().toISOString();
  const result = await context.env.DB.prepare(
    `UPDATE operator_accounts
        SET active = 0, deleted_at = ?1, session_version = session_version + 1,
            failed_attempts = 0, locked_until = NULL, updated_at = ?1
      WHERE id = ?2
        AND deleted_at IS NULL
        AND (
          role <> 'ADMIN'
          OR active = 0
          OR (
            SELECT COUNT(*) FROM operator_accounts
             WHERE role = 'ADMIN' AND active = 1 AND deleted_at IS NULL
          ) > 1
        )`,
  )
    .bind(now, accountId)
    .run();
  if (!result.meta.changes) {
    const account = await context.env.DB.prepare(
      `SELECT role, active FROM operator_accounts WHERE id = ?1 AND deleted_at IS NULL`,
    )
      .bind(accountId)
      .first<{ role: OperatorRole; active: number }>();
    if (!account) {
      return context.json(
        { error: { code: "ACCOUNT_NOT_FOUND", message: "Konto nicht gefunden." } },
        404,
      );
    }
    return context.json(
      {
        error: {
          code: "LAST_ACTIVE_ADMIN",
          message: "Das letzte aktive Administrationskonto kann nicht gelöscht werden.",
        },
      },
      409,
    );
  }
  await context.env.DB.prepare(
    "DELETE FROM dispatch_recommendation_leases WHERE operator_account_id = ?1",
  )
    .bind(accountId)
    .run();
  await context.env.DB.prepare(
    "DELETE FROM flight_line_assist_claims WHERE operator_account_id = ?1",
  )
    .bind(accountId)
    .run();
  return context.body(null, 204);
});

app.get("/api/device/context", async (context) => {
  const actor = await authorizeSession(context.env, context.req.raw);
  if (actor) {
    const event = await context.env.DB.prepare(
      `SELECT id FROM operation_days
        ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PREPARATION' THEN 1 ELSE 2 END,
                 event_date DESC LIMIT 1`,
    ).first<{ id: string }>();
    if (event) return context.json({ eventId: event.id, role: actor.role });
  }
  if (context.env.APP_ENV !== "development") {
    return context.json(
      { error: { code: "SESSION_REQUIRED", message: "Anmeldung erforderlich." } },
      401,
    );
  }
  const deviceId = context.req.header("x-device-id");
  if (!deviceId) {
    return context.json(
      { error: { code: "DEVICE_REQUIRED", message: "Gültige Sitzung erforderlich." } },
      403,
    );
  }
  const device = await context.env.DB.prepare(
    `SELECT operation_day_id, role, credential_hash FROM paired_devices
      WHERE id = ?1 AND active = 1`,
  )
    .bind(deviceId)
    .first<{ operation_day_id: string; role: string; credential_hash: string | null }>();
  if (
    !device ||
    !(await verifyCredential(context.req.header("x-device-token") ?? null, device.credential_hash))
  ) {
    return context.json(
      { error: { code: "DEVICE_REQUIRED", message: "Gültige Sitzung erforderlich." } },
      403,
    );
  }
  return context.json({ eventId: device.operation_day_id, role: device.role });
});

app.post("/api/admin/events/:eventId/verify-pin", async (context) => {
  const parsed = adminPinVerificationSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json(
      { error: { code: "INVALID_ADMIN_PIN", message: "Administrator-PIN ist unvollständig." } },
      400,
    );
  }
  const eventId = context.req.param("eventId");
  const authorized = await authorizeDevice(context.env, eventId, context.req.raw);
  const actor = await authorizeSession(context.env, context.req.raw);
  if (
    authorized?.role !== "ADMIN" ||
    (!actor && !(await verifyCredential(parsed.data.adminPin, context.env.ADMIN_PIN_HASH ?? null)))
  ) {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administrator-PIN ist nicht korrekt." } },
      403,
      { "cache-control": "no-store" },
    );
  }
  return context.json({ valid: true as const }, 200, { "cache-control": "no-store" });
});

app.post("/api/admin/events/:eventId/recover-device", async (context) => {
  if (context.env.APP_ENV !== "development") {
    return context.json(
      { error: { code: "SESSION_AUTH_ONLY", message: "Bitte erneut anmelden." } },
      410,
    );
  }
  const eventId = context.req.param("eventId");
  const deviceId = context.req.header("x-device-id")?.trim() ?? "";
  const parsed = adminDeviceRecoverySchema.safeParse(await context.req.json().catch(() => null));
  if (!deviceId || !parsed.success) {
    return context.json(
      { error: { code: "INVALID_ADMIN_RECOVERY", message: "Wiederherstellungsdaten fehlen." } },
      400,
    );
  }
  if (
    !(await allowAdminDeviceRecoveryAttempt(
      context.env.ADMIN_RECOVERY_RATE_LIMITER,
      context.req.raw,
    ))
  ) {
    return context.json(
      { error: { code: "TOO_MANY_ADMIN_ATTEMPTS", message: "Bitte später erneut versuchen." } },
      429,
      { "retry-after": "60" },
    );
  }
  const operationDay = await context.env.DB.prepare("SELECT id FROM operation_days WHERE id = ?1")
    .bind(eventId)
    .first<{ id: string }>();
  const device = await context.env.DB.prepare(
    `SELECT role FROM paired_devices WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
  )
    .bind(deviceId, eventId)
    .first<{ role: string }>();
  const adminAccounts = await context.env.DB.prepare(
    `SELECT pin_hash FROM operator_accounts
      WHERE role = 'ADMIN' AND active = 1 AND deleted_at IS NULL`,
  ).all<{ pin_hash: string }>();
  const currentAdminPinMatches = (
    await Promise.all(
      adminAccounts.results.map((account) => verifyPin(parsed.data.adminPin, account.pin_hash)),
    )
  ).some(Boolean);
  if (!operationDay || (device && device.role !== "ADMIN") || !currentAdminPinMatches) {
    return context.json(
      {
        error: {
          code: "ADMIN_RECOVERY_REJECTED",
          message: "Sitzung oder PIN ist nicht korrekt.",
        },
      },
      403,
    );
  }
  const now = new Date().toISOString();
  const auditPayload = JSON.stringify({ deviceId, recovery: "ADMIN_PIN" });
  await context.env.DB.batch([
    device
      ? context.env.DB.prepare(
          `UPDATE paired_devices
              SET credential_hash = ?1, last_seen_at = ?2
            WHERE id = ?3 AND operation_day_id = ?4 AND active = 1 AND role = 'ADMIN'`,
        ).bind(parsed.data.credentialHash, now, deviceId, eventId)
      : context.env.DB.prepare(
          `INSERT INTO paired_devices
            (id, operation_day_id, label, role, active, paired_at, last_seen_at, credential_hash)
           VALUES (?1, ?2, 'Administrationssitzung', 'ADMIN', 1, ?3, ?3, ?4)`,
        ).bind(deviceId, eventId, now, parsed.data.credentialHash),
    context.env.DB.prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json)
       VALUES (?1, ?2, 'ADMIN_DEVICE_CREDENTIAL_RECOVERED', ?3, ?4,
               'PAIRED_DEVICE', ?4, 0, ?5)`,
    ).bind(crypto.randomUUID(), eventId, now, deviceId, auditPayload),
    context.env.DB.prepare(
      `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
       VALUES (?1, ?2, 'ADMIN_DEVICE_CREDENTIAL_RECOVERED', ?3, ?4)`,
    ).bind(crypto.randomUUID(), eventId, auditPayload, now),
  ]);
  return context.json({ eventId, adminDeviceId: deviceId, role: "ADMIN" as const });
});

app.post("/api/admin/events/:eventId/factory-reset", async (context) => {
  const parsed = factoryResetRequestSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success || parsed.data.eventId !== context.req.param("eventId")) {
    return context.json(
      { error: { code: "INVALID_FACTORY_RESET", message: "Reset-Daten sind unvollständig." } },
      400,
    );
  }
  const input = parsed.data;
  const requestHash = await factoryResetRequestHash(input);
  const prior = await context.env.DB.prepare(
    `SELECT request_hash, completed_at, r2_cleanup_pending, response_json,
            setup_browser_binding_hash
       FROM system_reset_receipts WHERE command_id = ?1`,
  )
    .bind(input.commandId)
    .first<{
      request_hash: string;
      completed_at: string;
      r2_cleanup_pending: number;
      response_json: string;
      setup_browser_binding_hash: string | null;
    }>();
  if (prior) {
    const browserBindingHash = await sessionBrowserBindingHash(context.req.raw);
    if (
      !browserBindingHash ||
      !prior.setup_browser_binding_hash ||
      browserBindingHash !== prior.setup_browser_binding_hash
    ) {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    if (prior.request_hash !== requestHash) {
      return context.json(
        { error: { code: "IDEMPOTENCY_CONFLICT", message: "Reset-ID ist bereits belegt." } },
        409,
      );
    }
    let response = JSON.parse(prior.response_json) as FactoryResetResponse;
    if (prior.r2_cleanup_pending) {
      response = await finishR2Cleanup(context.env, input.commandId, response);
    }
    const token = await resetSetupToken(context.env, input.commandId, prior.completed_at);
    if (token) context.header("set-cookie", resetSetupCookie(token, context.req.raw));
    return context.json(response);
  }

  const actor = await authorizeSession(context.env, context.req.raw);
  const authorized = await authorizeDevice(context.env, input.eventId, context.req.raw, actor);
  if (actor?.role !== "ADMIN" || authorized?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const browserBindingHash = await sessionBrowserBindingHash(context.req.raw);
  if (!browserBindingHash) {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  if (
    !(await allowLoginAttempt(
      context.env.ADMIN_RECOVERY_RATE_LIMITER,
      context.req.raw,
      actor.accountId,
    ))
  ) {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      429,
      { "retry-after": "60" },
    );
  }
  const account = await context.env.DB.prepare(
    `SELECT pin_hash FROM operator_accounts
      WHERE id = ?1 AND active = 1 AND deleted_at IS NULL`,
  )
    .bind(actor.accountId)
    .first<{ pin_hash: string }>();
  if (!account || !(await verifyPin(input.adminPin, account.pin_hash))) {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const completedAt = new Date();
  const grantToken = await resetSetupToken(context.env, input.commandId, completedAt.toISOString());
  if (!grantToken) {
    return context.json(
      {
        error: {
          code: "RESET_SETUP_NOT_CONFIGURED",
          message: "Der sichere Einrichtungsübergang ist serverseitig nicht konfiguriert.",
        },
      },
      503,
    );
  }
  const grantHash = await sha256Hex(grantToken);
  const grantExpiresAt = resetSetupGrantExpiry(completedAt);

  const eventRows = await context.env.DB.prepare("SELECT id FROM operation_days").all<{
    id: string;
  }>();
  let recoveryBackupKey: string | null = null;
  if (input.retainRecoveryBackup) {
    try {
      recoveryBackupKey = (await createPortableBackup(context.env, new Date(), "FACTORY_RESET"))
        .key;
    } catch {
      return context.json(
        {
          error: {
            code: "FACTORY_RESET_BACKUP_FAILED",
            message: "Die Wiederherstellungssicherung konnte nicht erstellt werden.",
          },
        },
        500,
      );
    }
  }
  const coordinator = eventCoordinatorNamespace(context.env);
  try {
    await clearFactoryResetCoordinators(
      coordinator,
      eventRows.results.map(({ id }) => id),
    );
  } catch {
    return context.json(
      {
        error: {
          code: "FACTORY_RESET_COORDINATOR_FAILED",
          message:
            "Die laufenden Veranstaltungskoordinatoren konnten nicht vollständig geleert werden.",
        },
      },
      500,
    );
  }

  const response: FactoryResetResponse = {
    resetComplete: true,
    setupRequired: true,
    recoveryBackupKey,
    r2BackupsDeleted: false,
  };
  try {
    await context.env.DB.batch(
      factoryResetStatements(
        context.env,
        input.commandId,
        requestHash,
        completedAt.toISOString(),
        input.deleteAllBackups,
        response,
        grantHash,
        grantExpiresAt,
        browserBindingHash,
      ),
    );
  } catch {
    return context.json(
      {
        error: {
          code: "FACTORY_RESET_DATABASE_FAILED",
          message: "Die Anwendungsdaten konnten nicht vollständig zurückgesetzt werden.",
        },
      },
      500,
    );
  }
  if (input.deleteAllBackups) {
    try {
      const completedResponse = await finishR2Cleanup(context.env, input.commandId, response);
      context.header("set-cookie", resetSetupCookie(grantToken, context.req.raw));
      return context.json(completedResponse);
    } catch {
      context.header("set-cookie", resetSetupCookie(grantToken, context.req.raw));
      return context.json(response, 202);
    }
  }
  context.header("set-cookie", resetSetupCookie(grantToken, context.req.raw));
  return context.json(response);
});

app.get("/api/admin/events", async (context) => {
  const device = await authorizeDevice(
    context.env,
    context.req.header("x-event-id") ?? "",
    context.req.raw,
  );
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const rows = await context.env.DB.prepare(
    `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at,
            template_source_id, version
       FROM operation_days ORDER BY event_date DESC, name`,
  ).all<{
    id: string;
    name: string;
    event_date: string;
    aerodrome: string;
    time_zone: string;
    status: string;
    archived_at: string | null;
    template_source_id: string | null;
    version: number;
  }>();
  return context.json({
    events: rows.results.map((row) => ({
      eventId: row.id,
      name: row.name,
      eventDate: row.event_date,
      aerodrome: row.aerodrome,
      timeZone: row.time_zone,
      status: row.status,
      archivedAt: row.archived_at,
      templateSourceId: row.template_source_id,
      version: row.version,
    })),
  });
});

app.get("/api/admin/events/:eventId/flow", async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const event = await context.env.DB.prepare(
    `SELECT id, event_date, time_zone, sale_opens_at, operations_start_at, operations_end_at
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<{
      id: string;
      event_date: string;
      time_zone: string;
      sale_opens_at: string | null;
      operations_start_at: string | null;
      operations_end_at: string | null;
    }>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const tickets = await context.env.DB.prepare(
    `SELECT tg.sold_at,
            CASE WHEN r.status = 'COMPLETED' THEN r.completed_at ELSE NULL END AS completed_at
       FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       LEFT JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
       LEFT JOIN rotations r ON r.id = rt.rotation_id
      WHERE tg.operation_day_id = ?1 AND t.status <> 'CANCELED'
      ORDER BY tg.sold_at, t.id`,
  )
    .bind(eventId)
    .all<{ sold_at: string; completed_at: string | null }>();
  const requestedBucketMinutes = Number(context.req.query("bucketMinutes") ?? "15");
  const flow = buildAdminEventFlow({
    eventId,
    eventDate: event.event_date,
    timeZone: event.time_zone,
    saleOpensAt: event.sale_opens_at,
    operationsStartAt: event.operations_start_at,
    operationsEndAt: event.operations_end_at,
    observedAt: new Date().toISOString(),
    requestedBucketMinutes: Number.isFinite(requestedBucketMinutes) ? requestedBucketMinutes : 15,
    tickets: tickets.results.map((ticket) => ({
      soldAt: ticket.sold_at,
      completedAt: ticket.completed_at,
    })),
  });
  return context.json(adminEventFlowSchema.parse(flow));
});

app.get("/api/admin/events/:eventId/master-data-template", async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const event = await context.env.DB.prepare(
    `SELECT name, version, no_show_after_minutes, max_ticket_deferrals,
            notification_lead_minutes, automatic_precall_enabled, precall_lead_minutes,
            max_gate_wait_minutes, precall_min_quality, precall_gate_cooldown_minutes,
            child_reference_weight_kg, normal_reference_weight_kg, heavy_reference_weight_kg,
            planned_boarding_minutes, planned_deboarding_minutes, planned_buffer_minutes,
            departed_visibility_seconds
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<Record<string, string | number | null>>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const [gates, resourceGroups, products, pilots, assignments, turnaroundOverrides] =
    await Promise.all([
      context.env.DB.prepare(
        `SELECT id, label, gate_type, active, sort_order, travel_lead_minutes,
                display_filter_json
         FROM gates WHERE operation_day_id = ?1 ORDER BY sort_order, label, id`,
      )
        .bind(eventId)
        .all<Record<string, string | number>>(),
      context.env.DB.prepare(
        `SELECT id, name, short_code, gate_id, reference_capacity,
              compatible_aircraft_types_json, automatic_precall_enabled
         FROM resource_groups WHERE operation_day_id = ?1 ORDER BY name, id`,
      )
        .bind(eventId)
        .all<Record<string, string | number>>(),
      context.env.DB.prepare(
        `SELECT id, resource_group_id, gate_id, name, code, public_description, price_cents,
              reference_capacity, reference_duration_minutes, promised_flight_minutes,
              planned_boarding_minutes_override, planned_deboarding_minutes_override,
              planned_buffer_minutes_override,
              child_companion_required, weight_classes_json, sort_order,
              capacity_warning_threshold, capacity_critical_threshold
         FROM products WHERE operation_day_id = ?1 ORDER BY sort_order, name, id`,
      )
        .bind(eventId)
        .all<Record<string, string | number | null>>(),
      context.env.DB.prepare(
        `SELECT id, operational_code, operational_note, active
         FROM pilots WHERE operation_day_id = ?1 ORDER BY operational_code, id`,
      )
        .bind(eventId)
        .all<Record<string, string | number>>(),
      context.env.DB.prepare(
        `SELECT m.aircraft_id, m.resource_group_id, a.registration, a.aircraft_type,
              a.passenger_seats, a.maximum_passenger_payload_kg, a.refuel_reminder_threshold
         FROM resource_group_memberships m
         JOIN aircraft a ON a.id = m.aircraft_id
        WHERE m.operation_day_id = ?1 AND m.active_until IS NULL
        ORDER BY a.registration, a.id`,
      )
        .bind(eventId)
        .all<Record<string, string | number | null>>(),
      context.env.DB.prepare(
        `SELECT aircraft_id, product_id, planned_boarding_minutes_override,
              planned_deboarding_minutes_override, planned_buffer_minutes_override
         FROM aircraft_product_turnaround_overrides
        WHERE operation_day_id = ?1 ORDER BY product_id, aircraft_id`,
      )
        .bind(eventId)
        .all<Record<string, string | number | null>>(),
    ]);
  const gateKeys = new Map(
    gates.results.map((gate, index) => [String(gate.id), `gate-${index + 1}`]),
  );
  const resourceGroupKeys = new Map(
    resourceGroups.results.map((group, index) => [String(group.id), `resource-group-${index + 1}`]),
  );
  const productKeys = new Map(
    products.results.map((product, index) => [String(product.id), `product-${index + 1}`]),
  );
  const aircraftRows = [
    ...new Map(
      assignments.results.map((assignment) => [String(assignment.aircraft_id), assignment]),
    ).values(),
  ];
  const aircraftKeys = new Map(
    aircraftRows.map((aircraft, index) => [String(aircraft.aircraft_id), `aircraft-${index + 1}`]),
  );
  const template = masterDataTemplateSchema.parse({
    format: "rundflug-master-data-template",
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    source: { name: event.name, version: Number(event.version) },
    eventParameters: {
      noShowAfterMinutes: Number(event.no_show_after_minutes),
      maxTicketDeferrals: Number(event.max_ticket_deferrals),
      notificationLeadMinutes: Number(event.notification_lead_minutes),
      automaticPrecallEnabled: Boolean(event.automatic_precall_enabled),
      precallLeadMinutes: Number(event.precall_lead_minutes),
      maximumGateWaitMinutes: Number(event.max_gate_wait_minutes),
      precallMinimumQuality: String(event.precall_min_quality),
      precallGateCooldownMinutes: Number(event.precall_gate_cooldown_minutes),
      referenceWeightsKg: {
        child: Number(event.child_reference_weight_kg),
        normal: Number(event.normal_reference_weight_kg),
        heavy: Number(event.heavy_reference_weight_kg),
      },
      plannedBoardingMinutes: Number(event.planned_boarding_minutes),
      plannedDeboardingMinutes: Number(event.planned_deboarding_minutes),
      plannedBufferMinutes: Number(event.planned_buffer_minutes),
      departedVisibilitySeconds: Number(event.departed_visibility_seconds),
    },
    gates: gates.results.map((gate) => {
      const displayFilter = parseGateDisplayFilterJson(String(gate.display_filter_json));
      return {
        key: gateKeys.get(String(gate.id)),
        label: String(gate.label),
        gateType: String(gate.gate_type),
        active: Boolean(gate.active),
        sortOrder: Number(gate.sort_order),
        travelLeadMinutes: Number(gate.travel_lead_minutes),
        displayFilter: {
          productKeys: displayFilter.productIds.flatMap((productId) => {
            const productKey = productKeys.get(productId);
            return productKey ? [productKey] : [];
          }),
          rotationStatuses: displayFilter.rotationStatuses,
        },
      };
    }),
    resourceGroups: resourceGroups.results.map((group) => ({
      key: resourceGroupKeys.get(String(group.id)),
      name: String(group.name),
      shortCode: String(group.short_code),
      gateKey: gateKeys.get(String(group.gate_id)),
      referenceCapacity: Number(group.reference_capacity),
      compatibleAircraftTypes: JSON.parse(String(group.compatible_aircraft_types_json)),
      automaticPrecallEnabled: Boolean(group.automatic_precall_enabled),
    })),
    aircraft: aircraftRows.map((aircraft) => ({
      key: aircraftKeys.get(String(aircraft.aircraft_id)),
      registration: String(aircraft.registration),
      aircraftType: String(aircraft.aircraft_type),
      passengerSeats: Number(aircraft.passenger_seats),
      maximumPassengerPayloadKg:
        aircraft.maximum_passenger_payload_kg === null
          ? null
          : Number(aircraft.maximum_passenger_payload_kg),
      refuelReminderThreshold: Number(aircraft.refuel_reminder_threshold),
    })),
    assignments: assignments.results.map((assignment) => ({
      aircraftKey: aircraftKeys.get(String(assignment.aircraft_id)),
      resourceGroupKey: resourceGroupKeys.get(String(assignment.resource_group_id)),
    })),
    pilots: pilots.results.map((pilot, index) => ({
      key: `pilot-${index + 1}`,
      operationalCode: String(pilot.operational_code),
      operationalNote: String(pilot.operational_note),
      active: Boolean(pilot.active),
    })),
    products: products.results.map((product) => ({
      key: productKeys.get(String(product.id)),
      resourceGroupKey: resourceGroupKeys.get(String(product.resource_group_id)),
      gateKey: gateKeys.get(String(product.gate_id)),
      name: String(product.name),
      code: String(product.code),
      publicDescription: String(product.public_description),
      priceCents: Number(product.price_cents),
      referenceCapacity: Number(product.reference_capacity),
      referenceDurationMinutes: Number(product.reference_duration_minutes),
      promisedFlightMinutes: Number(product.promised_flight_minutes),
      plannedBoardingMinutesOverride:
        product.planned_boarding_minutes_override === null
          ? null
          : Number(product.planned_boarding_minutes_override),
      plannedDeboardingMinutesOverride:
        product.planned_deboarding_minutes_override === null
          ? null
          : Number(product.planned_deboarding_minutes_override),
      plannedBufferMinutesOverride:
        product.planned_buffer_minutes_override === null
          ? null
          : Number(product.planned_buffer_minutes_override),
      childCompanionRequired: Boolean(product.child_companion_required),
      weightClasses: JSON.parse(String(product.weight_classes_json)),
      sortOrder: Number(product.sort_order),
      capacityWarningThreshold: Number(product.capacity_warning_threshold),
      capacityCriticalThreshold: Number(product.capacity_critical_threshold),
    })),
    aircraftProductTurnaroundOverrides: turnaroundOverrides.results.map((override) => ({
      aircraftKey: aircraftKeys.get(String(override.aircraft_id)),
      productKey: productKeys.get(String(override.product_id)),
      plannedBoardingMinutesOverride:
        override.planned_boarding_minutes_override === null
          ? null
          : Number(override.planned_boarding_minutes_override),
      plannedDeboardingMinutesOverride:
        override.planned_deboarding_minutes_override === null
          ? null
          : Number(override.planned_deboarding_minutes_override),
      plannedBufferMinutesOverride:
        override.planned_buffer_minutes_override === null
          ? null
          : Number(override.planned_buffer_minutes_override),
    })),
  });
  return context.json(template, 200, {
    "content-disposition": `attachment; filename="stammdaten-${eventId}.json"`,
  });
});

app.on("GET", eventRoutes("/exports/simulation-plan.json"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diesen Simulationsexport nicht berechtigt.",
        },
      },
      403,
    );
  }
  const exportedAt = new Date().toISOString();
  const [projection, plans, recurringRules] = await Promise.all([
    loadMasterDataExportProjection(context.env.DB, eventId, exportedAt),
    context.env.DB.prepare(
      `SELECT id, scope_type, scope_id, constraint_kind, effect_mode,
                duration_multiplier_percent, start_mode,
                earliest_start_at, latest_start_at, after_rotation_id,
                minimum_duration_minutes, typical_duration_minutes, maximum_duration_minutes,
                public_note
           FROM planned_operational_constraints
          WHERE operation_day_id = ?1 AND status = 'PLANNED' AND recurring_rule_id IS NULL
          ORDER BY COALESCE(earliest_start_at, created_at), created_at, id`,
    )
      .bind(eventId)
      .all<{
        id: string;
        scope_type: "EVENT" | "RESOURCE_GROUP" | "AIRCRAFT" | "PILOT";
        scope_id: string;
        constraint_kind: "PAUSE" | "REFUELING" | "FLIGHT_SHOW" | "WEATHER" | "TECHNICAL" | "OTHER";
        effect_mode: "BLOCKING" | "SLOWDOWN";
        duration_multiplier_percent: number | null;
        start_mode: "TIME_WINDOW" | "AFTER_CURRENT_ROTATION";
        earliest_start_at: string | null;
        latest_start_at: string | null;
        after_rotation_id: string | null;
        minimum_duration_minutes: number;
        typical_duration_minutes: number;
        maximum_duration_minutes: number;
        public_note: string;
      }>(),
    context.env.DB.prepare(
      `SELECT id, scope_type, scope_id, operation_kind, trigger_metric, interval_value,
              progress_value, minimum_duration_minutes, typical_duration_minutes,
              maximum_duration_minutes
         FROM recurring_operational_rules
        WHERE operation_day_id = ?1 AND status = 'ACTIVE'
        ORDER BY scope_type, scope_id, operation_kind, id`,
    )
      .bind(eventId)
      .all<{
        id: string;
        scope_type: "AIRCRAFT" | "PILOT";
        scope_id: string;
        operation_kind: "PAUSE" | "REFUELING";
        trigger_metric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
        interval_value: number;
        progress_value: number;
        minimum_duration_minutes: number;
        typical_duration_minutes: number;
        maximum_duration_minutes: number;
      }>(),
  ]);
  if (!projection) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  if (!projection.schedule) {
    return context.json(
      {
        error: {
          code: "SIMULATION_SCHEDULE_INCOMPLETE",
          message: "Verkaufs- und Betriebszeiten müssen vor dem Export vollständig sein.",
        },
      },
      409,
    );
  }
  const plannedOperations = plans.results.map((plan, index) => {
    const scopeKey =
      plan.scope_type === "EVENT"
        ? "event"
        : plan.scope_type === "RESOURCE_GROUP"
          ? projection.keys.resourceGroups.get(plan.scope_id)
          : plan.scope_type === "AIRCRAFT"
            ? projection.keys.aircraft.get(plan.scope_id)
            : projection.keys.pilots.get(plan.scope_id);
    if (!scopeKey) {
      throw new Error(`Simulationsexport: Ziel für Planeintrag ${plan.id} fehlt.`);
    }
    return {
      key: `plan-${index + 1}`,
      scopeType: plan.scope_type,
      scopeKey,
      kind: plan.constraint_kind,
      effectMode: plan.effect_mode,
      durationMultiplierPercent: plan.duration_multiplier_percent,
      startMode: plan.start_mode,
      earliestStartAt: plan.earliest_start_at,
      latestStartAt: plan.latest_start_at,
      afterCurrentRotation: plan.after_rotation_id !== null,
      minimumDurationMinutes: plan.minimum_duration_minutes,
      typicalDurationMinutes: plan.typical_duration_minutes,
      maximumDurationMinutes: plan.maximum_duration_minutes,
      publicNote: plan.public_note,
    };
  });
  const simulationPlan = simulationPlanExportSchema.parse({
    format: "rundflug-simulation-plan",
    formatVersion: 3,
    exportedAt,
    source: projection.template.source,
    schedule: projection.schedule,
    masterData: projection.template,
    plannedOperations,
    recurringRules: recurringRules.results.map((rule, index) => {
      const scopeKey =
        rule.scope_type === "AIRCRAFT"
          ? projection.keys.aircraft.get(rule.scope_id)
          : projection.keys.pilots.get(rule.scope_id);
      if (!scopeKey) {
        throw new Error(`Simulationsexport: Ziel für Regel ${rule.id} fehlt.`);
      }
      return {
        key: `rule-${index + 1}`,
        scopeType: rule.scope_type,
        scopeKey,
        kind: rule.operation_kind,
        triggerMetric: rule.trigger_metric,
        intervalValue: rule.interval_value,
        progressValue: rule.progress_value,
        minimumDurationMinutes: rule.minimum_duration_minutes,
        typicalDurationMinutes: rule.typical_duration_minutes,
        maximumDurationMinutes: rule.maximum_duration_minutes,
      };
    }),
  });
  return context.json(simulationPlan, 200, {
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="simulationsplan-${eventId}.json"`,
  });
});

app.post("/api/admin/events/:eventId/master-data-template/validate", async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  let body: unknown;
  try {
    body = await boundedJsonBody(context.req.raw);
  } catch (cause) {
    return context.json(
      {
        error: {
          code:
            cause instanceof Error && cause.message === "TEMPLATE_TOO_LARGE"
              ? "TEMPLATE_TOO_LARGE"
              : "TEMPLATE_INVALID",
          message: "Die Vorlagendatei ist ungültig oder größer als 1 MiB.",
        },
      },
      400,
    );
  }
  const parsed = masterDataTemplateValidationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return context.json(
      {
        error: {
          code: "TEMPLATE_INVALID",
          message: parsed.error.issues[0]?.message ?? "Ungültige Vorlage.",
        },
      },
      400,
    );
  }
  const target = await loadTemplateTarget(context.env.DB, eventId);
  if (!target) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const aircraftValidation = await validateTemplateAircraft(context.env.DB, parsed.data.template);
  const response = masterDataTemplateValidationSchema.parse({
    valid: aircraftValidation.errors.length === 0,
    targetEligible: templateTargetEligible(target),
    counts: masterDataTemplateCounts(parsed.data.template),
    errors: aircraftValidation.errors,
    warnings:
      aircraftValidation.existingByRegistration.size > 0
        ? [
            `${aircraftValidation.existingByRegistration.size} bestehende Flugzeuge werden anhand ihrer Kennung wiederverwendet.`,
          ]
        : [],
  });
  return context.json(response);
});

app.post("/api/admin/events/:eventId/master-data-template/import", async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  let body: unknown;
  try {
    body = await boundedJsonBody(context.req.raw);
  } catch (cause) {
    return context.json(
      {
        error: {
          code:
            cause instanceof Error && cause.message === "TEMPLATE_TOO_LARGE"
              ? "TEMPLATE_TOO_LARGE"
              : "TEMPLATE_INVALID",
          message: "Die Vorlagendatei ist ungültig oder größer als 1 MiB.",
        },
      },
      400,
    );
  }
  const parsed = importMasterDataTemplateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return context.json(
      {
        error: {
          code: "TEMPLATE_INVALID",
          message: parsed.error.issues[0]?.message ?? "Ungültige Vorlage.",
        },
      },
      400,
    );
  }
  const input = parsed.data;
  const priorReceipt = await context.env.DB.prepare(
    `SELECT operation_day_id, device_id, response_json
       FROM idempotency_receipts WHERE command_id = ?1`,
  )
    .bind(input.commandId)
    .first<{ operation_day_id: string; device_id: string; response_json: string }>();
  if (priorReceipt) {
    if (priorReceipt.operation_day_id !== eventId || priorReceipt.device_id !== device.id) {
      return context.json(
        { error: { code: "IDEMPOTENCY_CONFLICT", message: "Kommando-ID ist bereits belegt." } },
        409,
      );
    }
    const stored = importMasterDataTemplateResponseSchema.parse(
      JSON.parse(priorReceipt.response_json),
    );
    return context.json({ ...stored, duplicate: true });
  }
  const target = await loadTemplateTarget(context.env.DB, eventId);
  if (!target) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  if (target.version !== input.expectedVersion) {
    return context.json(
      {
        error: { code: "STALE_VERSION", message: "Veranstaltung wurde zwischenzeitlich geändert." },
      },
      409,
    );
  }
  if (!templateTargetEligible(target)) {
    return context.json(
      {
        error: {
          code: "TEMPLATE_TARGET_NOT_EMPTY",
          message: "Import ist nur in eine leere Veranstaltung in Vorbereitung möglich.",
        },
      },
      409,
    );
  }
  const aircraftValidation = await validateTemplateAircraft(context.env.DB, input.template);
  if (aircraftValidation.errors.length > 0) {
    return context.json(
      {
        error: {
          code: "TEMPLATE_AIRCRAFT_CONFLICT",
          message: aircraftValidation.errors[0]?.message,
        },
      },
      409,
    );
  }

  const now = new Date().toISOString();
  const gateIds = new Map(input.template.gates.map((entry) => [entry.key, crypto.randomUUID()]));
  const resourceGroupIds = new Map(
    input.template.resourceGroups.map((entry) => [entry.key, crypto.randomUUID()]),
  );
  const productIds = new Map(
    input.template.products.map((entry) => [entry.key, crypto.randomUUID()]),
  );
  const aircraftIds = new Map(
    input.template.aircraft.map((entry) => [
      entry.key,
      aircraftValidation.existingByRegistration.get(entry.registration)?.id ?? crypto.randomUUID(),
    ]),
  );
  const counts = masterDataTemplateCounts(input.template);
  const responseBody = importMasterDataTemplateResponseSchema.parse({
    accepted: true,
    duplicate: false,
    eventId,
    version: input.expectedVersion + 1,
    counts,
  });
  const receiptGuard = `EXISTS (
    SELECT 1 FROM idempotency_receipts
     WHERE operation_day_id = ?1 AND command_id = ?2
  )`;
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(
      `INSERT INTO idempotency_receipts
        (command_id, operation_day_id, device_id, command_type, received_at, response_json)
       SELECT ?1, ?2, ?3, 'IMPORT_MASTER_DATA_TEMPLATE', ?4, ?5
        WHERE EXISTS (
          SELECT 1 FROM operation_days
           WHERE id = ?2 AND version = ?6 AND status = 'PREPARATION'
        )`,
    ).bind(
      input.commandId,
      eventId,
      device.id,
      now,
      JSON.stringify(responseBody),
      input.expectedVersion,
    ),
  ];
  for (const aircraft of input.template.aircraft) {
    if (aircraftValidation.existingByRegistration.has(aircraft.registration)) continue;
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO aircraft
          (id, registration, aircraft_type, passenger_seats, created_at, updated_at,
           maximum_passenger_payload_kg, refuel_reminder_threshold)
         SELECT ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9 WHERE ${receiptGuard}`,
      ).bind(
        eventId,
        input.commandId,
        aircraftIds.get(aircraft.key),
        aircraft.registration,
        aircraft.aircraftType,
        aircraft.passengerSeats,
        now,
        aircraft.maximumPassengerPayloadKg,
        aircraft.refuelReminderThreshold,
      ),
    );
  }
  for (const gate of input.template.gates) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO gates
          (id, operation_day_id, label, gate_type, active, sort_order, travel_lead_minutes,
           display_filter_json, created_at, updated_at)
         SELECT ?3, ?1, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10 WHERE ${receiptGuard}`,
      ).bind(
        eventId,
        input.commandId,
        gateIds.get(gate.key),
        gate.label,
        gate.gateType,
        gate.active ? 1 : 0,
        gate.sortOrder,
        gate.travelLeadMinutes,
        JSON.stringify({
          productIds: gate.displayFilter.productKeys.map((key) => productIds.get(key)),
          rotationStatuses: gate.displayFilter.rotationStatuses,
        }),
        now,
      ),
    );
  }
  for (const group of input.template.resourceGroups) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO resource_groups
          (id, operation_day_id, name, short_code, status, version, created_at, updated_at,
           gate_id, reference_capacity,
           compatible_aircraft_types_json, automatic_precall_enabled)
         SELECT ?3, ?1, ?4, ?5, 'ACTIVE', 0, ?6, ?6, ?7, ?8, ?9, ?10
          WHERE ${receiptGuard}`,
      ).bind(
        eventId,
        input.commandId,
        resourceGroupIds.get(group.key),
        group.name,
        group.shortCode,
        now,
        gateIds.get(group.gateKey),
        group.referenceCapacity,
        JSON.stringify(group.compatibleAircraftTypes),
        group.automaticPrecallEnabled ? 1 : 0,
      ),
    );
  }
  for (const product of input.template.products) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO products
          (id, operation_day_id, resource_group_id, name, price_cents, sale_enabled,
           created_at, updated_at, capacity_warning_threshold, capacity_critical_threshold,
           code, public_description, child_companion_required, sort_order, weight_classes_json,
           gate_id, reference_capacity, reference_duration_minutes, promised_flight_minutes,
           planned_boarding_minutes_override, planned_deboarding_minutes_override,
           planned_buffer_minutes_override)
         SELECT ?3, ?1, ?4, ?5, ?6, 0, ?7, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                ?15, ?16, ?17, ?18, ?19, ?20, ?21 WHERE ${receiptGuard}`,
      ).bind(
        eventId,
        input.commandId,
        productIds.get(product.key),
        resourceGroupIds.get(product.resourceGroupKey),
        product.name,
        product.priceCents,
        now,
        product.capacityWarningThreshold,
        product.capacityCriticalThreshold,
        product.code,
        product.publicDescription,
        product.childCompanionRequired ? 1 : 0,
        product.sortOrder,
        JSON.stringify(product.weightClasses),
        gateIds.get(product.gateKey),
        product.referenceCapacity,
        product.referenceDurationMinutes,
        product.promisedFlightMinutes,
        product.plannedBoardingMinutesOverride,
        product.plannedDeboardingMinutesOverride,
        product.plannedBufferMinutesOverride,
      ),
    );
  }
  for (const pilot of input.template.pilots) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO pilots
          (id, operation_day_id, operational_code, operational_note, active, created_at, updated_at)
         SELECT ?3, ?1, ?4, ?5, ?6, ?7, ?7 WHERE ${receiptGuard}`,
      ).bind(
        eventId,
        input.commandId,
        crypto.randomUUID(),
        pilot.operationalCode,
        pilot.operationalNote,
        pilot.active ? 1 : 0,
        now,
      ),
    );
  }
  for (const assignment of input.template.assignments) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO resource_group_memberships
          (id, operation_day_id, resource_group_id, aircraft_id, active_from, created_at,
           change_reason, changed_by_device_id)
         SELECT ?3, ?1, ?4, ?5, ?6, ?6, 'Stammdatenvorlage importiert', ?7
          WHERE ${receiptGuard}`,
      ).bind(
        eventId,
        input.commandId,
        crypto.randomUUID(),
        resourceGroupIds.get(assignment.resourceGroupKey),
        aircraftIds.get(assignment.aircraftKey),
        now,
        device.id,
      ),
    );
  }
  for (const override of input.template.aircraftProductTurnaroundOverrides) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO aircraft_product_turnaround_overrides
          (operation_day_id, aircraft_id, product_id, planned_boarding_minutes_override,
           planned_deboarding_minutes_override, planned_buffer_minutes_override, version,
           created_at, updated_at)
         SELECT ?1, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8 WHERE ${receiptGuard}`,
      ).bind(
        eventId,
        input.commandId,
        aircraftIds.get(override.aircraftKey),
        productIds.get(override.productKey),
        override.plannedBoardingMinutesOverride,
        override.plannedDeboardingMinutesOverride,
        override.plannedBufferMinutesOverride,
        now,
      ),
    );
  }
  const parameters = input.template.eventParameters;
  statements.push(
    context.env.DB.prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json)
       SELECT ?3, ?1, 'MASTER_DATA_TEMPLATE_IMPORTED', ?4, ?5, 'OPERATION_DAY', ?1, ?6, ?7
        WHERE ${receiptGuard}`,
    ).bind(
      eventId,
      input.commandId,
      crypto.randomUUID(),
      now,
      device.id,
      input.expectedVersion + 1,
      JSON.stringify({ formatVersion: input.template.formatVersion, counts }),
    ),
    context.env.DB.prepare(
      `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
       SELECT ?3, ?1, 'MASTER_DATA_TEMPLATE_IMPORTED', ?4, ?5 WHERE ${receiptGuard}`,
    ).bind(
      eventId,
      input.commandId,
      crypto.randomUUID(),
      JSON.stringify({ eventId, version: input.expectedVersion + 1, counts }),
      now,
    ),
    context.env.DB.prepare(
      `UPDATE operation_days
          SET no_show_after_minutes = ?3, max_ticket_deferrals = ?4,
              notification_lead_minutes = ?5, automatic_precall_enabled = ?6,
              precall_lead_minutes = ?7, max_gate_wait_minutes = ?8,
              precall_min_quality = ?9, precall_gate_cooldown_minutes = ?10,
              child_reference_weight_kg = ?11, normal_reference_weight_kg = ?12,
              heavy_reference_weight_kg = ?13, planned_boarding_minutes = ?14,
              planned_deboarding_minutes = ?15, planned_buffer_minutes = ?16,
              departed_visibility_seconds = ?17, version = version + 1, updated_at = ?18
        WHERE id = ?1 AND version = ?2 AND status = 'PREPARATION'
          AND EXISTS (
            SELECT 1 FROM idempotency_receipts
             WHERE operation_day_id = ?1 AND command_id = ?19
          )`,
    ).bind(
      eventId,
      input.expectedVersion,
      parameters.noShowAfterMinutes,
      parameters.maxTicketDeferrals,
      parameters.notificationLeadMinutes,
      parameters.automaticPrecallEnabled ? 1 : 0,
      parameters.precallLeadMinutes,
      parameters.maximumGateWaitMinutes,
      parameters.precallMinimumQuality,
      parameters.precallGateCooldownMinutes,
      parameters.referenceWeightsKg.child,
      parameters.referenceWeightsKg.normal,
      parameters.referenceWeightsKg.heavy,
      parameters.plannedBoardingMinutes,
      parameters.plannedDeboardingMinutes,
      parameters.plannedBufferMinutes,
      parameters.departedVisibilitySeconds,
      now,
      input.commandId,
    ),
  );
  const results = await context.env.DB.batch(statements);
  const updateResult = results.at(-1);
  if (updateResult?.meta.changes !== 1) {
    const concurrentReceipt = await context.env.DB.prepare(
      "SELECT response_json, device_id FROM idempotency_receipts WHERE command_id = ?1",
    )
      .bind(input.commandId)
      .first<{ response_json: string; device_id: string }>();
    if (concurrentReceipt?.device_id === device.id) {
      const stored = importMasterDataTemplateResponseSchema.parse(
        JSON.parse(concurrentReceipt.response_json),
      );
      return context.json({ ...stored, duplicate: true });
    }
    return context.json(
      {
        error: { code: "STALE_VERSION", message: "Veranstaltung wurde zwischenzeitlich geändert." },
      },
      409,
    );
  }
  return context.json(responseBody, 201);
});

app.post("/api/admin/events/:sourceEventId/clone", async (context) => {
  const sourceEventId = context.req.param("sourceEventId");
  const sourceAdmin = await authorizeDevice(context.env, sourceEventId, context.req.raw);
  if (sourceAdmin?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const legacySourceCredential =
    context.env.APP_ENV === "development"
      ? await context.env.DB.prepare(
          `SELECT credential_hash FROM paired_devices
            WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
        )
          .bind(sourceAdmin.id, sourceEventId)
          .first<{ credential_hash: string | null }>()
      : null;
  const parsed = cloneEventRequestSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json(
      { error: { code: "INVALID_EVENT", message: "Veranstaltungsdaten sind unvollständig." } },
      400,
    );
  }
  const input = parsed.data;
  const receipt = await context.env.DB.prepare(
    `SELECT operation_day_id, device_id, response_json FROM idempotency_receipts
      WHERE command_id = ?1`,
  )
    .bind(input.commandId)
    .first<{ operation_day_id: string; device_id: string; response_json: string }>();
  if (receipt) {
    if (receipt.operation_day_id !== sourceEventId || receipt.device_id !== sourceAdmin.id) {
      return context.json(
        { error: { code: "IDEMPOTENCY_CONFLICT", message: "Kommando-ID ist bereits belegt." } },
        409,
      );
    }
    return context.json(JSON.parse(receipt.response_json));
  }
  const existing = await context.env.DB.prepare("SELECT id FROM operation_days WHERE id = ?1")
    .bind(input.eventId)
    .first();
  if (existing) {
    return context.json(
      {
        error: {
          code: "EVENT_ID_EXISTS",
          message: "Diese Veranstaltungs-ID ist bereits vergeben.",
        },
      },
      409,
    );
  }
  const source = await context.env.DB.prepare("SELECT * FROM operation_days WHERE id = ?1")
    .bind(sourceEventId)
    .first<Record<string, unknown>>();
  if (!source) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Vorveranstaltung nicht gefunden." } },
      404,
    );
  }
  if (Number(source.version) !== input.expectedSourceVersion) {
    return context.json(
      {
        error: {
          code: "STALE_VERSION",
          message: "Die Vorveranstaltung wurde zwischenzeitlich geändert. Bitte neu laden.",
        },
      },
      409,
    );
  }
  const [gates, groups, products, pilots, memberships, turnaroundOverrides] = await Promise.all([
    context.env.DB.prepare("SELECT * FROM gates WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    context.env.DB.prepare("SELECT * FROM resource_groups WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    context.env.DB.prepare("SELECT * FROM products WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    context.env.DB.prepare("SELECT * FROM pilots WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    context.env.DB.prepare(
      "SELECT * FROM resource_group_memberships WHERE operation_day_id = ?1 AND active_until IS NULL",
    )
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    context.env.DB.prepare(
      "SELECT * FROM aircraft_product_turnaround_overrides WHERE operation_day_id = ?1",
    )
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
  ]);
  const now = new Date().toISOString();
  const keepMasterData = input.restartMode === "KEEP_MASTER_DATA";
  const gateIds = new Map(gates.results.map((row) => [String(row.id), crypto.randomUUID()]));
  const groupIds = new Map(groups.results.map((row) => [String(row.id), crypto.randomUUID()]));
  const productIds = new Map(products.results.map((row) => [String(row.id), crypto.randomUUID()]));
  const adminDeviceId = crypto.randomUUID();
  const responseBody = {
    eventId: input.eventId,
    templateSourceId: sourceEventId,
    ...(context.env.APP_ENV === "development" ? { adminDeviceId } : {}),
  };
  const statements = [
    context.env.DB.prepare(
      `INSERT INTO operation_days
        (id, name, event_date, time_zone, status, emergency_mode, operational_note, version,
         created_at, updated_at, operations_end_at, operational_interrupted, sale_opens_at,
         no_show_after_minutes, max_ticket_deferrals, notification_lead_minutes,
         child_reference_weight_kg,
         normal_reference_weight_kg, heavy_reference_weight_kg, planned_boarding_minutes,
         planned_deboarding_minutes, planned_buffer_minutes, aerodrome, template_source_id)
       VALUES (?1, ?2, ?3, ?4, 'PREPARATION', 0, '', 0, ?5, ?5, NULL, 0, NULL,
         ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    ).bind(
      input.eventId,
      input.name,
      input.eventDate,
      input.timeZone,
      now,
      source.no_show_after_minutes,
      source.max_ticket_deferrals,
      source.notification_lead_minutes,
      source.child_reference_weight_kg,
      source.normal_reference_weight_kg,
      source.heavy_reference_weight_kg,
      source.planned_boarding_minutes,
      source.planned_deboarding_minutes,
      source.planned_buffer_minutes,
      input.aerodrome,
      sourceEventId,
    ),
    ...(keepMasterData ? gates.results : []).map((row) =>
      context.env.DB.prepare(
        `INSERT INTO gates
          (id, operation_day_id, label, gate_type, active, sort_order, travel_lead_minutes,
           display_filter_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      ).bind(
        gateIds.get(String(row.id)),
        input.eventId,
        row.label,
        row.gate_type,
        row.active,
        row.sort_order,
        row.travel_lead_minutes,
        JSON.stringify({
          ...gateDisplayFilterSchema.parse(JSON.parse(String(row.display_filter_json))),
          productIds: gateDisplayFilterSchema
            .parse(JSON.parse(String(row.display_filter_json)))
            .productIds.flatMap((id) => {
              const mappedId = productIds.get(id);
              return mappedId ? [mappedId] : [];
            }),
        }),
        now,
      ),
    ),
    ...(keepMasterData ? groups.results : []).map((row) =>
      context.env.DB.prepare(
        `INSERT INTO resource_groups
        (id, operation_day_id, name, short_code, status, version, created_at, updated_at, gate_id,
         reference_capacity, compatible_aircraft_types_json)
       VALUES (?1, ?2, ?3, ?4, 'ACTIVE', 0, ?5, ?5, ?6, ?7, ?8)`,
      ).bind(
        groupIds.get(String(row.id)),
        input.eventId,
        row.name,
        row.short_code,
        now,
        row.gate_id ? gateIds.get(String(row.gate_id)) : null,
        row.reference_capacity,
        row.compatible_aircraft_types_json,
      ),
    ),
    ...(keepMasterData ? products.results : []).map((row) =>
      context.env.DB.prepare(
        `INSERT INTO products
        (id, operation_day_id, resource_group_id, name, price_cents, sale_enabled, created_at,
          updated_at, sale_closes_at, capacity_warning_threshold, capacity_critical_threshold,
          code, public_description, child_companion_required, sort_order, weight_classes_json, gate_id,
          reference_capacity, reference_duration_minutes, promised_flight_minutes,
          planned_boarding_minutes_override, planned_deboarding_minutes_override,
          planned_buffer_minutes_override)
        VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6, NULL, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
          ?15, ?16, ?17, ?18, ?19, ?20)`,
      ).bind(
        productIds.get(String(row.id)),
        input.eventId,
        groupIds.get(String(row.resource_group_id)),
        row.name,
        row.price_cents,
        now,
        row.capacity_warning_threshold,
        row.capacity_critical_threshold,
        row.code,
        row.public_description,
        row.child_companion_required,
        row.sort_order,
        row.weight_classes_json,
        row.gate_id ? gateIds.get(String(row.gate_id)) : null,
        row.reference_capacity,
        row.reference_duration_minutes,
        row.promised_flight_minutes,
        row.planned_boarding_minutes_override,
        row.planned_deboarding_minutes_override,
        row.planned_buffer_minutes_override,
      ),
    ),
    ...(keepMasterData ? pilots.results : []).map((row) =>
      context.env.DB.prepare(
        `INSERT INTO pilots (id, operation_day_id, operational_code, active, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
      ).bind(crypto.randomUUID(), input.eventId, row.operational_code, row.active, now),
    ),
    ...(keepMasterData ? memberships.results : []).map((row) =>
      context.env.DB.prepare(
        `INSERT INTO resource_group_memberships
        (id, operation_day_id, resource_group_id, aircraft_id, active_from, created_at,
         change_reason, changed_by_device_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'Aus Vorveranstaltung übernommen', ?6)`,
      ).bind(
        crypto.randomUUID(),
        input.eventId,
        groupIds.get(String(row.resource_group_id)),
        row.aircraft_id,
        now,
        adminDeviceId,
      ),
    ),
    ...(keepMasterData ? turnaroundOverrides.results : []).map((row) =>
      context.env.DB.prepare(
        `INSERT INTO aircraft_product_turnaround_overrides
          (operation_day_id, aircraft_id, product_id, planned_boarding_minutes_override,
           planned_deboarding_minutes_override, planned_buffer_minutes_override, version,
           created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)`,
      ).bind(
        input.eventId,
        row.aircraft_id,
        productIds.get(String(row.product_id)),
        row.planned_boarding_minutes_override,
        row.planned_deboarding_minutes_override,
        row.planned_buffer_minutes_override,
        now,
      ),
    ),
    context.env.DB.prepare(
      `INSERT INTO paired_devices
        (id, operation_day_id, label, role, active, paired_at, last_seen_at, credential_hash)
       VALUES (?1, ?2, 'Übernommene Administrationssitzung', 'ADMIN', 1, ?3, ?3, ?4)`,
    ).bind(adminDeviceId, input.eventId, now, legacySourceCredential?.credential_hash ?? null),
    context.env.DB.prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json)
       VALUES (?1, ?2, 'EVENT_CREATED_FROM_TEMPLATE', ?3, ?4, 'OPERATION_DAY', ?2, 0, ?5)`,
    ).bind(
      crypto.randomUUID(),
      input.eventId,
      now,
      adminDeviceId,
      JSON.stringify({ templateSourceId: sourceEventId, restartMode: input.restartMode }),
    ),
    context.env.DB.prepare(
      `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
       VALUES (?1, ?2, 'EVENT_CREATED_FROM_TEMPLATE', ?3, ?4)`,
    ).bind(crypto.randomUUID(), input.eventId, JSON.stringify(responseBody), now),
    context.env.DB.prepare(
      `INSERT INTO idempotency_receipts
        (command_id, operation_day_id, device_id, command_type, received_at, response_json)
       VALUES (?1, ?2, ?3, 'CREATE_EVENT_FROM_TEMPLATE', ?4, ?5)`,
    ).bind(input.commandId, sourceEventId, sourceAdmin.id, now, JSON.stringify(responseBody)),
  ];
  await context.env.DB.batch(statements);
  return context.json(responseBody, 201);
});

app.delete("/api/admin/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  const sourceEventId = context.req.header("x-event-id")?.trim() || eventId;
  const input = (await context.req.json().catch(() => null)) as {
    commandId?: string;
    expectedVersion?: number;
    confirmation?: string;
    reason?: string;
  } | null;
  const reason = input?.reason?.trim() ?? "";
  if (
    !input?.commandId ||
    !Number.isInteger(input.expectedVersion) ||
    (input.expectedVersion ?? -1) < 0 ||
    input.confirmation !== eventId ||
    reason.length < 3
  ) {
    return context.json(
      {
        error: {
          code: "EVENT_DELETE_CONFIRMATION_INVALID",
          message:
            "Kommando-ID, Version, Veranstaltungs-ID und Begründung müssen bestätigt werden.",
        },
      },
      400,
    );
  }
  const requestHash = await sha256Hex(
    JSON.stringify({
      sourceEventId,
      eventId,
      expectedVersion: input.expectedVersion,
      confirmation: input.confirmation,
      reason,
    }),
  );
  const prior = await context.env.DB.prepare(
    `SELECT request_hash, actor_device_id, browser_binding_hash, legacy_credential_hash,
            r2_cleanup_pending, logo_object_keys_json, response_json
       FROM event_deletion_receipts WHERE command_id = ?1`,
  )
    .bind(input.commandId)
    .first<{
      request_hash: string;
      actor_device_id: string;
      browser_binding_hash: string | null;
      legacy_credential_hash: string | null;
      r2_cleanup_pending: number;
      logo_object_keys_json: string;
      response_json: string;
    }>();
  if (prior) {
    const browserBindingHash = await sessionBrowserBindingHash(context.req.raw);
    const browserMatches =
      Boolean(browserBindingHash) && browserBindingHash === prior.browser_binding_hash;
    const legacyMatches =
      context.env.APP_ENV === "development" &&
      context.req.header("x-device-id") === prior.actor_device_id &&
      (await verifyCredential(
        context.req.header("x-device-token") ?? null,
        prior.legacy_credential_hash,
      ));
    if (!browserMatches && !legacyMatches) {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    if (prior.request_hash !== requestHash) {
      return context.json(
        { error: { code: "IDEMPOTENCY_CONFLICT", message: "Kommando-ID ist bereits belegt." } },
        409,
      );
    }
    let response = JSON.parse(prior.response_json) as EventDeletionResponse;
    if (prior.r2_cleanup_pending) {
      const logoObjectKeys = JSON.parse(prior.logo_object_keys_json) as string[];
      try {
        response = await finishEventDeletionAssetCleanup(
          context.env,
          input.commandId,
          logoObjectKeys,
          response,
        );
      } catch {
        return context.json(response, 202);
      }
    }
    return context.json(response);
  }

  const device = await authorizeDevice(context.env, sourceEventId, context.req.raw);
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const event = await context.env.DB.prepare(
    `SELECT id, version, logo_object_key, logo_dark_object_key
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<{
      id: string;
      version: number;
      logo_object_key: string | null;
      logo_dark_object_key: string | null;
    }>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  if (event.version !== input.expectedVersion) {
    return context.json(
      {
        error: {
          code: "EVENT_VERSION_CONFLICT",
          message: "Die Veranstaltung wurde inzwischen geändert.",
          currentVersion: event.version,
        },
      },
      409,
    );
  }
  const count = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM operation_days").first<{
    count: number;
  }>();
  const lastEvent = (count?.count ?? 0) <= 1;
  const bootstrap = await context.env.DB.prepare(
    "SELECT operation_day_id FROM app_bootstrap WHERE singleton = 1",
  ).first<{ operation_day_id: string }>();
  const sessionRebindEvent = !lastEvent
    ? await context.env.DB.prepare(
        `SELECT id
             FROM operation_days
            WHERE id <> ?1
            ORDER BY CASE WHEN id = ?2 THEN 0 ELSE 1 END,
                     event_date DESC, created_at DESC, id
            LIMIT 1`,
      )
        .bind(eventId, sourceEventId)
        .first<{ id: string }>()
    : null;
  if (!lastEvent && !sessionRebindEvent) {
    return context.json(
      {
        error: {
          code: "EVENT_DELETE_REPLACEMENT_MISSING",
          message: "Für aktive Sitzungen wurde keine verbleibende Veranstaltung gefunden.",
        },
      },
      409,
    );
  }
  const replacement =
    !lastEvent && bootstrap?.operation_day_id === eventId
      ? await context.env.DB.prepare(
          `SELECT operation_day.id, device.id AS admin_device_id
             FROM operation_days operation_day
             JOIN paired_devices device
               ON device.operation_day_id = operation_day.id
              AND device.role = 'ADMIN'
              AND device.active = 1
            WHERE operation_day.id <> ?1
            ORDER BY CASE WHEN operation_day.id = ?2 THEN 0 ELSE 1 END,
                     operation_day.event_date DESC,
                     operation_day.created_at DESC,
                     operation_day.id,
                     device.paired_at
            LIMIT 1`,
        )
          .bind(eventId, sourceEventId)
          .first<{ id: string; admin_device_id: string }>()
      : null;
  if (!lastEvent && bootstrap?.operation_day_id === eventId && !replacement) {
    return context.json(
      {
        error: {
          code: "EVENT_DELETE_BOOTSTRAP_REPLACEMENT_MISSING",
          message: "Für die verbleibende Veranstaltung fehlt eine aktive Administrationssitzung.",
        },
      },
      409,
    );
  }
  const browserBindingHash = await sessionBrowserBindingHash(context.req.raw);
  const legacyCredentialHash =
    browserBindingHash === null && context.env.APP_ENV === "development"
      ? ((
          await context.env.DB.prepare(
            `SELECT credential_hash FROM paired_devices
              WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
          )
            .bind(device.id, sourceEventId)
            .first<{ credential_hash: string | null }>()
        )?.credential_hash ?? null)
      : null;
  if (!browserBindingHash && !legacyCredentialHash) {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const coordinator = context.env.EVENT_COORDINATOR.get(
    context.env.EVENT_COORDINATOR.idFromName(eventId),
  );
  const cleared = await coordinator.fetch(`https://internal/events/${eventId}/factory-reset`, {
    method: "POST",
  });
  if (!cleared.ok) {
    return context.json(
      { error: { code: "EVENT_BUSY", message: "Veranstaltung konnte nicht geleert werden." } },
      409,
    );
  }
  const logoObjectKeys = [...new Set([event.logo_object_key, event.logo_dark_object_key])].filter(
    (key): key is string => Boolean(key),
  );
  const completedAt = new Date().toISOString();
  const response: EventDeletionResponse = {
    deleted: true,
    eventId,
    setupRequired: lastEvent,
    assetCleanupPending: true,
  };
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare("UPDATE system_reset_control SET active = 1 WHERE singleton = 1"),
  ];
  if (lastEvent) {
    statements.push(context.env.DB.prepare("DELETE FROM app_bootstrap"));
  } else if (replacement) {
    statements.push(
      context.env.DB.prepare(
        `UPDATE app_bootstrap
            SET operation_day_id = ?1, admin_device_id = ?2
          WHERE singleton = 1 AND operation_day_id = ?3`,
      ).bind(replacement.id, replacement.admin_device_id, eventId),
    );
  }
  if (sessionRebindEvent) {
    statements.push(
      context.env.DB.prepare(
        `UPDATE paired_devices
            SET operation_day_id = ?1, last_seen_at = ?2
          WHERE operation_day_id = ?3
            AND id IN (
              SELECT device_id
                FROM operator_sessions
               WHERE revoked_at IS NULL
                 AND absolute_expires_at > ?2
            )`,
      ).bind(sessionRebindEvent.id, completedAt, eventId),
    );
  }
  statements.push(...eventDeletionStatements(context.env, eventId));
  if (lastEvent) {
    statements.push(
      context.env.DB.prepare("DELETE FROM operator_sessions"),
      context.env.DB.prepare("DELETE FROM operator_accounts"),
    );
  }
  statements.push(
    context.env.DB.prepare("UPDATE system_reset_control SET active = 0 WHERE singleton = 1"),
    context.env.DB.prepare(
      `INSERT INTO event_deletion_receipts
          (command_id, request_hash, source_operation_day_id, target_operation_day_id,
           target_version, actor_device_id, browser_binding_hash, legacy_credential_hash,
           completed_at, r2_cleanup_pending, logo_object_keys_json, response_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    ).bind(
      input.commandId,
      requestHash,
      sourceEventId,
      eventId,
      event.version,
      device.id,
      browserBindingHash,
      legacyCredentialHash,
      completedAt,
      1,
      JSON.stringify(logoObjectKeys),
      JSON.stringify(response),
    ),
  );
  await context.env.DB.batch(statements);
  try {
    return context.json(
      await finishEventDeletionAssetCleanup(context.env, input.commandId, logoObjectKeys, response),
    );
  } catch {
    return context.json(response, 202);
  }
});

app.put("/api/admin/events/:eventId/logo", async (context) => {
  const eventId = context.req.param("eventId");
  const theme = parseEventLogoTheme(context.req.query("theme") ?? null);
  if (!theme) {
    return context.json(
      { error: { code: "EVENT_LOGO_THEME_INVALID", message: "Logo-Theme ist ungültig." } },
      400,
    );
  }
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const expectedVersion = Number(context.req.header("x-expected-version"));
  const commandId = context.req.header("x-command-id")?.trim();
  if (!commandId || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return context.json(
      { error: { code: "INVALID_COMMAND", message: "Kommando-ID oder Version fehlt." } },
      400,
    );
  }
  const commandType = eventLogoCommandType("SET", theme);
  const receiptInput = {
    eventId,
    deviceId: device.id,
    commandType,
    theme,
    operation: "SET" as const,
  };
  const existingReceipt = await findEventLogoReceipt(context.env, commandId);
  if (existingReceipt) {
    if (!eventLogoReceiptMatches(existingReceipt, receiptInput)) {
      return context.json(
        { error: { code: "IDEMPOTENCY_CONFLICT", message: "Kommando-ID ist bereits belegt." } },
        409,
      );
    }
    return context.json(JSON.parse(existingReceipt.response_json));
  }
  const columns = eventLogoColumns(theme);
  const event = await context.env.DB.prepare(
    `SELECT version, logo_object_key, logo_media_type,
            logo_dark_object_key, logo_dark_media_type
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<EventLogoRow>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  if (event.version !== expectedVersion) {
    return context.json(
      {
        error: { code: "STALE_VERSION", message: "Veranstaltung wurde zwischenzeitlich geändert." },
      },
      409,
    );
  }
  let bytes: Uint8Array;
  let mediaType: ReturnType<typeof validateEventLogo>;
  try {
    bytes = await readEventLogoBytes(context.req.raw);
    mediaType = validateEventLogo(bytes, context.req.header("content-type") ?? null);
  } catch {
    return context.json(
      {
        error: {
          code: "EVENT_LOGO_INVALID",
          message: "Logo muss ein sicheres PNG, JPEG, WebP oder SVG bis 1 MiB sein.",
        },
      },
      400,
    );
  }
  const now = new Date().toISOString();
  const objectKey = `event-logos/${eventId}/${crypto.randomUUID()}.${eventLogoExtension(mediaType)}`;
  await context.env.BACKUPS.put(objectKey, bytes, {
    httpMetadata: { contentType: mediaType },
    customMetadata: { eventId, theme },
  });
  const response = {
    logoUrl: `/api/public/events/${encodeURIComponent(eventId)}/logo?theme=${theme}`,
    theme,
  };
  const responseJson = JSON.stringify(response);
  const mutationGuard = `id = ?1 AND version = ?2 AND ${columns.key} = ?3`;
  let results: D1Result[];
  try {
    results = await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE operation_days
            SET ${columns.key} = ?1, ${columns.mediaType} = ?2, logo_updated_at = ?3,
                version = version + 1, updated_at = ?3
          WHERE id = ?4 AND version = ?5`,
      ).bind(objectKey, mediaType, now, eventId, expectedVersion),
      context.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         SELECT ?4, ?1, 'EVENT_LOGO_CHANGED', ?5, ?6, 'OPERATION_DAY', ?1, ?2, ?7
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(
        eventId,
        expectedVersion + 1,
        objectKey,
        crypto.randomUUID(),
        now,
        device.id,
        JSON.stringify({ theme, mediaType }),
      ),
      context.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         SELECT ?4, ?1, ?5, ?6, ?7, ?8
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(
        eventId,
        expectedVersion + 1,
        objectKey,
        commandId,
        device.id,
        commandType,
        now,
        responseJson,
      ),
      context.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         SELECT ?4, ?1, 'EVENT_STATE_CHANGED', ?5, ?6
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(eventId, expectedVersion + 1, objectKey, crypto.randomUUID(), responseJson, now),
    ]);
  } catch (cause) {
    await context.env.BACKUPS.delete(objectKey);
    const concurrentReceipt = await findEventLogoReceipt(context.env, commandId);
    if (concurrentReceipt) {
      if (!eventLogoReceiptMatches(concurrentReceipt, receiptInput)) {
        return context.json(
          { error: { code: "IDEMPOTENCY_CONFLICT", message: "Kommando-ID ist bereits belegt." } },
          409,
        );
      }
      return context.json(JSON.parse(concurrentReceipt.response_json));
    }
    throw cause;
  }
  if (results[0]?.meta.changes !== 1) {
    await context.env.BACKUPS.delete(objectKey);
    return context.json(
      {
        error: { code: "STALE_VERSION", message: "Veranstaltung wurde zwischenzeitlich geändert." },
      },
      409,
    );
  }
  const previousObjectKey = event[columns.key];
  if (previousObjectKey && previousObjectKey !== objectKey) {
    await context.env.BACKUPS.delete(previousObjectKey);
  }
  return context.json(response);
});

app.delete("/api/admin/events/:eventId/logo", async (context) => {
  const eventId = context.req.param("eventId");
  const theme = parseEventLogoTheme(context.req.query("theme") ?? null);
  if (!theme) {
    return context.json(
      { error: { code: "EVENT_LOGO_THEME_INVALID", message: "Logo-Theme ist ungültig." } },
      400,
    );
  }
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const expectedVersion = Number(context.req.header("x-expected-version"));
  const commandId = context.req.header("x-command-id")?.trim();
  if (!commandId || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return context.json(
      { error: { code: "INVALID_COMMAND", message: "Kommando-ID oder Version fehlt." } },
      400,
    );
  }
  const commandType = eventLogoCommandType("REMOVE", theme);
  const receiptInput = {
    eventId,
    deviceId: device.id,
    commandType,
    theme,
    operation: "REMOVE" as const,
  };
  const existingReceipt = await findEventLogoReceipt(context.env, commandId);
  if (existingReceipt) {
    if (!eventLogoReceiptMatches(existingReceipt, receiptInput)) {
      return context.json(
        { error: { code: "IDEMPOTENCY_CONFLICT", message: "Kommando-ID ist bereits belegt." } },
        409,
      );
    }
    return context.json(JSON.parse(existingReceipt.response_json));
  }
  const columns = eventLogoColumns(theme);
  const event = await context.env.DB.prepare(
    `SELECT version, logo_object_key, logo_media_type,
            logo_dark_object_key, logo_dark_media_type
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<EventLogoRow>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  if (event.version !== expectedVersion) {
    return context.json(
      {
        error: { code: "STALE_VERSION", message: "Veranstaltung wurde zwischenzeitlich geändert." },
      },
      409,
    );
  }
  const now = new Date().toISOString();
  const previousObjectKey = event[columns.key];
  const response = { removed: Boolean(previousObjectKey), theme };
  const responseJson = JSON.stringify(response);
  if (!previousObjectKey) {
    try {
      const result = await context.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
           FROM operation_days
          WHERE id = ?2 AND version = ?7 AND ${columns.key} IS NULL`,
      )
        .bind(commandId, eventId, device.id, commandType, now, responseJson, expectedVersion)
        .run();
      if (result.meta.changes !== 1) {
        return context.json(
          {
            error: {
              code: "STALE_VERSION",
              message: "Veranstaltung wurde zwischenzeitlich geändert.",
            },
          },
          409,
        );
      }
    } catch (cause) {
      const concurrentReceipt = await findEventLogoReceipt(context.env, commandId);
      if (concurrentReceipt) {
        if (!eventLogoReceiptMatches(concurrentReceipt, receiptInput)) {
          return context.json(
            { error: { code: "IDEMPOTENCY_CONFLICT", message: "Kommando-ID ist bereits belegt." } },
            409,
          );
        }
        return context.json(JSON.parse(concurrentReceipt.response_json));
      }
      throw cause;
    }
    return context.json(response);
  }

  const mutationGuard = `id = ?1 AND version = ?2 AND ${columns.key} IS NULL AND logo_updated_at = ?3`;
  let results: D1Result[];
  try {
    results = await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE operation_days
            SET ${columns.key} = NULL, ${columns.mediaType} = NULL,
                logo_updated_at = ?1, version = version + 1, updated_at = ?1
          WHERE id = ?2 AND version = ?3 AND ${columns.key} = ?4`,
      ).bind(now, eventId, expectedVersion, previousObjectKey),
      context.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         SELECT ?4, ?1, 'EVENT_LOGO_REMOVED', ?3, ?5, 'OPERATION_DAY', ?1, ?2, ?6
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(
        eventId,
        expectedVersion + 1,
        now,
        crypto.randomUUID(),
        device.id,
        JSON.stringify({ theme }),
      ),
      context.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         SELECT ?4, ?1, ?5, ?6, ?3, ?7
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(eventId, expectedVersion + 1, now, commandId, device.id, commandType, responseJson),
      context.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         SELECT ?4, ?1, 'EVENT_STATE_CHANGED', ?5, ?3
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(eventId, expectedVersion + 1, now, crypto.randomUUID(), responseJson),
    ]);
  } catch (cause) {
    const concurrentReceipt = await findEventLogoReceipt(context.env, commandId);
    if (concurrentReceipt) {
      if (!eventLogoReceiptMatches(concurrentReceipt, receiptInput)) {
        return context.json(
          { error: { code: "IDEMPOTENCY_CONFLICT", message: "Kommando-ID ist bereits belegt." } },
          409,
        );
      }
      return context.json(JSON.parse(concurrentReceipt.response_json));
    }
    throw cause;
  }
  if (results[0]?.meta.changes !== 1) {
    return context.json(
      {
        error: { code: "STALE_VERSION", message: "Veranstaltung wurde zwischenzeitlich geändert." },
      },
      409,
    );
  }
  await context.env.BACKUPS.delete(previousObjectKey);
  return context.json(response);
});

app.get("/api/public/events/:eventId/logo", async (context) => {
  const eventId = context.req.param("eventId");
  const requestedTheme = parseEventLogoTheme(context.req.query("theme") ?? null);
  if (!requestedTheme) {
    return context.json(
      { error: { code: "EVENT_LOGO_THEME_INVALID", message: "Logo-Theme ist ungültig." } },
      400,
    );
  }
  const event = await context.env.DB.prepare(
    `SELECT version, logo_object_key, logo_media_type,
            logo_dark_object_key, logo_dark_media_type
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<EventLogoRow>();
  if (!event) return context.body(null, 404);
  const fallbackTheme: EventLogoTheme = requestedTheme === "light" ? "dark" : "light";
  for (const resolvedTheme of [requestedTheme, fallbackTheme]) {
    const columns = eventLogoColumns(resolvedTheme);
    const objectKey = event[columns.key];
    const mediaType = event[columns.mediaType];
    if (!objectKey || !mediaType) continue;
    const object = await context.env.BACKUPS.get(objectKey);
    if (!object) continue;
    return new Response(object.body, {
      headers: {
        "content-type": mediaType,
        "cache-control": "public, max-age=300",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
        "x-event-logo-theme": resolvedTheme,
      },
    });
  }
  return context.body(null, 404);
});

app.on("GET", eventRoutes("/snapshot"), async (context) => {
  const row = await context.env.DB.prepare(
    `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
            emergency_mode, operational_interrupted, version,
            operational_note, operations_start_at, operations_end_at, sale_opens_at,
            no_show_after_minutes,
            max_ticket_deferrals,
            notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
            automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
            precall_min_quality, precall_gate_cooldown_minutes,
            heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
            planned_buffer_minutes, logo_object_key, logo_dark_object_key, updated_at
       FROM operation_days
      WHERE id = ?1`,
  )
    .bind(context.req.param("eventId"))
    .first<StoredEventRow>();
  if (!row) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  return context.json(rowToSnapshot(row));
});

app.on("PUT", eventRoutes("/assist-claims/:aircraftId"), async (context) => {
  const eventId = context.req.param("eventId");
  const aircraftId = context.req.param("aircraftId");
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor || !["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"].includes(actor.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const target = new URL(context.req.url);
  target.pathname = `/internal/events/${encodeURIComponent(eventId)}/assist-claims/${encodeURIComponent(aircraftId)}`;
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-operator-account-id", actor.accountId);
  headers.set("x-operator-login-code", actor.loginCode);
  headers.set("x-operator-session-id", actor.sessionId);
  headers.set("x-operator-role", actor.role);
  headers.set("x-operator-device-id", actor.deviceId);
  const body = await context.req.json().catch(() => ({ action: "ACQUIRE_OR_RENEW" }));
  const response = await stub.fetch(
    new Request(target, { method: "PUT", headers, body: JSON.stringify(body) }),
  );
  return new Response(response.body, response);
});

app.on("DELETE", eventRoutes("/assist-claims/:aircraftId"), async (context) => {
  const eventId = context.req.param("eventId");
  const aircraftId = context.req.param("aircraftId");
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor || !["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"].includes(actor.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const target = new URL(context.req.url);
  target.pathname = `/internal/events/${encodeURIComponent(eventId)}/assist-claims/${encodeURIComponent(aircraftId)}`;
  const headers = new Headers();
  headers.set("x-operator-account-id", actor.accountId);
  headers.set("x-operator-login-code", actor.loginCode);
  headers.set("x-operator-session-id", actor.sessionId);
  headers.set("x-operator-role", actor.role);
  headers.set("x-operator-device-id", actor.deviceId);
  const response = await stub.fetch(new Request(target, { method: "DELETE", headers }));
  return new Response(response.body, response);
});

app.on("POST", eventRoutes("/dispatch-recommendation-leases"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor || !["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"].includes(actor.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const target = new URL(context.req.url);
  target.pathname = `/internal/events/${encodeURIComponent(eventId)}/dispatch-recommendation-leases`;
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-operator-account-id", actor.accountId);
  headers.set("x-operator-login-code", actor.loginCode);
  headers.set("x-operator-session-id", actor.sessionId);
  headers.set("x-operator-role", actor.role);
  headers.set("x-operator-device-id", actor.deviceId);
  const body: unknown = await context.req.json().catch(() => null);
  const response = await stub.fetch(
    new Request(target, { method: "POST", headers, body: JSON.stringify(body) }),
  );
  return new Response(response.body, response);
});

app.on("DELETE", eventRoutes("/dispatch-recommendation-leases/:leaseId"), async (context) => {
  const eventId = context.req.param("eventId");
  const leaseId = context.req.param("leaseId");
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor || !["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"].includes(actor.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const target = new URL(context.req.url);
  target.pathname = `/internal/events/${encodeURIComponent(eventId)}/dispatch-recommendation-leases/${encodeURIComponent(leaseId)}`;
  const headers = new Headers();
  headers.set("x-operator-account-id", actor.accountId);
  headers.set("x-operator-login-code", actor.loginCode);
  headers.set("x-operator-session-id", actor.sessionId);
  headers.set("x-operator-role", actor.role);
  headers.set("x-operator-device-id", actor.deviceId);
  const response = await stub.fetch(new Request(target, { method: "DELETE", headers }));
  return new Response(response.body, response);
});

app.on("GET", eventRoutes("/fids/preferences"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor || !mayAccessFids(actor.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const event = await context.env.DB.prepare("SELECT id FROM operation_days WHERE id = ?1")
    .bind(eventId)
    .first<{ id: string }>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  return context.json(await loadFidsPreferences(context.env.DB, actor.accountId, eventId));
});

app.on("PUT", eventRoutes("/fids/preferences"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor || !mayAccessFids(actor.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const target = new URL(context.req.url);
  target.pathname = `/internal/events/${encodeURIComponent(eventId)}/fids/preferences`;
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-operator-account-id", actor.accountId);
  headers.set("x-operator-login-code", actor.loginCode);
  headers.set("x-operator-session-id", actor.sessionId);
  headers.set("x-operator-role", actor.role);
  headers.set("x-operator-device-id", actor.deviceId);
  const body = await context.req.text();
  const response = await stub.fetch(new Request(target, { method: "PUT", headers, body }));
  return new Response(response.body, response);
});

app.on("GET", eventRoutes("/fids/filter-options"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor || !mayAccessFids(actor.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const event = await context.env.DB.prepare("SELECT id FROM operation_days WHERE id = ?1")
    .bind(eventId)
    .first<{ id: string }>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const [gates, products] = await runD1ReadsSequentially([
    () =>
      context.env.DB.prepare(
        `SELECT id, label, active
           FROM gates
          WHERE operation_day_id = ?1
          ORDER BY active DESC, label COLLATE NOCASE, id`,
      )
        .bind(eventId)
        .all<{ id: string; label: string; active: number }>(),
    () =>
      context.env.DB.prepare(
        `SELECT p.id, p.code, p.name, COALESCE(p.gate_id, rg.gate_id) AS gate_id,
                p.sale_enabled AS active
           FROM products p
           JOIN resource_groups rg ON rg.id = p.resource_group_id
          WHERE p.operation_day_id = ?1
          ORDER BY p.sale_enabled DESC, p.sort_order, p.code COLLATE NOCASE, p.id`,
      )
        .bind(eventId)
        .all<{ id: string; code: string; name: string; gate_id: string; active: number }>(),
  ] as const);
  return context.json({
    gates: gates.results.map((gate) => ({
      id: gate.id,
      label: gate.label,
      active: gate.active === 1,
    })),
    products: products.results.map((product) => ({
      id: product.id,
      code: product.code,
      name: product.name,
      gateId: product.gate_id,
      active: product.active === 1,
    })),
  } satisfies FidsFilterOptions);
});

app.on("GET", eventRoutes("/fids/board"), async (context) => {
  const requestStartedAt = performance.now();
  const eventId = context.req.param("eventId");
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor || !mayAccessFids(actor.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const event = await loadFidsProjectionEvent(context.env.DB, eventId);
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const preferences = await loadFidsPreferences(context.env.DB, actor.accountId, eventId);
  const page = parseFidsPage(context.req.query("page"));
  const lowerPage = parseFidsPage(context.req.query("lowerPage"));
  const boardReadAt = new Date().toISOString();
  const departedVisibilityCutoff = new Date(
    Date.now() - event.departed_visibility_seconds * 1_000,
  ).toISOString();
  const filter: FidsProjectionFilter = {
    productIds: preferences.contentFilter.productIds,
    gateIds: preferences.contentFilter.gateIds,
    rotationStatuses: [],
  };
  const baseProjection = {
    eventId,
    filter,
    departedVisibilityCutoff,
    now: boardReadAt,
  };
  const [fleet, projectionRows] =
    event.emergency_mode === 1
      ? [[], []]
      : await Promise.all([
          loadFidsProjectionFleet(context.env.DB, eventId),
          loadAllFidsProjectionRows(context.env.DB, { ...baseProjection, band: "ALL" }),
        ]);
  const displayedRows = groupSharedFidsFlights(
    orderFidsRows(projectionRows.map((row) => mapFidsProjectionRow(row, event, boardReadAt))),
    preferences.groupSharedFlights,
  );

  let priority: FidsBoardResponse["priority"] = null;
  let boardPage: FidsBoardResponse["page"];
  if (event.emergency_mode === 1) {
    boardPage = {
      requestedPage: preferences.viewMode === "SPLIT" ? lowerPage : page,
      pageSize:
        preferences.viewMode === "SPLIT"
          ? preferences.visibleRows - preferences.priorityGroupCount
          : preferences.visibleRows,
      totalItems: 0,
      totalPages: 0,
      groups: [],
    };
    if (preferences.viewMode === "SPLIT") {
      priority = {
        configuredCapacity: preferences.priorityGroupCount,
        effectiveCapacity: preferences.priorityGroupCount,
        totalItems: 0,
        overflowCount: 0,
        groups: [],
      };
    }
  } else if (preferences.viewMode === "FIXED_PAGE") {
    boardPage = paginateFidsRows(displayedRows, page, preferences.visibleRows);
  } else {
    const splitProjection = partitionFidsRows({
      rows: displayedRows,
      visibleRows: preferences.visibleRows,
      priorityGroupCount: preferences.priorityGroupCount,
      lowerPage,
    });
    priority = splitProjection.priority;
    boardPage = splitProjection.page;
  }

  const response = context.json({
    eventName: event.name,
    timeZone: event.time_zone,
    emergencyMode: event.emergency_mode === 1,
    operationalInterrupted: event.operational_interrupted === 1,
    operationalNotice: event.planned_public_note || event.operational_note,
    departedVisibilitySeconds: event.departed_visibility_seconds,
    updatedAt: event.updated_at,
    preferencesVersion: preferences.version,
    viewMode: preferences.viewMode,
    filterSummary: preferences.contentFilter,
    priority,
    page: boardPage,
    fleet: event.emergency_mode
      ? []
      : fleet.map((aircraft) => ({
          registration: aircraft.registration,
          status: aircraft.operational_state as FidsBoardResponse["fleet"][number]["status"],
          refuelPlanned: aircraft.refuel_planned === 1,
        })),
  } satisfies FidsBoardResponse);
  response.headers.set(
    "server-timing",
    `fids-board;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
  );
  return response;
});

app.on("GET", eventRoutes("/operations"), async (context) => {
  const requestStartedAt = performance.now();
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(
    context.env,
    eventId,
    context.req.raw,
    context.get("sessionActor"),
  );
  if (!device || device.role === "DISPLAY") {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }

  const eventRow = await context.env.DB.prepare(
    `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
            emergency_mode, operational_interrupted, version,
            operational_note, operations_start_at, operations_end_at, sale_opens_at,
            no_show_after_minutes,
            max_ticket_deferrals,
            notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
            automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
            precall_min_quality, precall_gate_cooldown_minutes,
            heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
            planned_buffer_minutes, logo_object_key, logo_dark_object_key, updated_at
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<StoredEventRow>();
  if (!eventRow) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const projectionReadAt = new Date().toISOString();

  const [
    products,
    aircraftProductTurnaroundOverrideRows,
    rotations,
    queueGroupRows,
    dispatchLeaseRows,
    durationRows,
    aircraftRows,
    fleetRows,
    pilotRows,
    gatesRows,
    resourceGroupRows,
    plannedOperationRows,
    recurringRuleRows,
    metricsRow,
  ] = await runD1ReadsSequentially([
    () =>
      context.env.DB.prepare(
        `SELECT p.id, p.code, p.name, p.public_description, p.resource_group_id, rg.name AS resource_group_name,
              rg.status AS resource_group_status, rg.operational_note AS resource_group_operational_note,
              p.price_cents, p.sale_enabled, p.reference_capacity, p.reference_duration_minutes,
              p.promised_flight_minutes,
              p.planned_boarding_minutes_override, p.planned_deboarding_minutes_override,
              p.planned_buffer_minutes_override,
              p.sale_closes_at, p.capacity_warning_threshold, p.capacity_critical_threshold,
              p.child_companion_required, p.weight_classes_json, p.sort_order, p.gate_id,
              g.label AS gate_label,
              COUNT(CASE WHEN t.status = 'QUEUED' THEN 1 END) AS queued_tickets,
              (SELECT COUNT(*) FROM tickets shared_t
                JOIN ticket_groups shared_tg ON shared_tg.id = shared_t.ticket_group_id
                JOIN products shared_p ON shared_p.id = shared_tg.product_id
               WHERE shared_p.resource_group_id = p.resource_group_id
                 AND shared_t.status = 'QUEUED') AS resource_group_open_tickets
         FROM products p
         JOIN resource_groups rg ON rg.id = p.resource_group_id
         JOIN gates g ON g.id = p.gate_id
         LEFT JOIN ticket_groups tg ON tg.product_id = p.id
         LEFT JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE p.operation_day_id = ?1
        GROUP BY p.id
        ORDER BY p.sort_order, p.name, p.id`,
      )
        .bind(eventId)
        .all<{
          id: string;
          code: string;
          name: string;
          public_description: string;
          resource_group_id: string;
          resource_group_name: string;
          resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
          resource_group_operational_note: string;
          price_cents: number;
          gate_id: string;
          gate_label: string;
          child_companion_required: number;
          weight_classes_json: string;
          sort_order: number;
          sale_enabled: number;
          reference_capacity: number;
          reference_duration_minutes: number;
          promised_flight_minutes: number;
          planned_boarding_minutes_override: number | null;
          planned_deboarding_minutes_override: number | null;
          planned_buffer_minutes_override: number | null;
          queued_tickets: number;
          resource_group_open_tickets: number;
          sale_closes_at: string | null;
          capacity_warning_threshold: number;
          capacity_critical_threshold: number;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT aircraft_id, product_id, planned_boarding_minutes_override,
                planned_deboarding_minutes_override, planned_buffer_minutes_override, version
           FROM aircraft_product_turnaround_overrides
          WHERE operation_day_id = ?1
          ORDER BY product_id, aircraft_id`,
      )
        .bind(eventId)
        .all<{
          aircraft_id: string;
          product_id: string;
          planned_boarding_minutes_override: number | null;
          planned_deboarding_minutes_override: number | null;
          planned_buffer_minutes_override: number | null;
          version: number;
        }>(),
    () =>
      context.env.DB.prepare(
        withBookingGroupPartProjection(
          `SELECT r.id, r.version, r.flight_group_id, fg.resource_group_id,
              rotation_rg.short_code AS resource_group_short_code, fg.communication_number,
              COALESCE(fg.queue_position, fg.communication_number) AS queue_position,
              r.status, r.aircraft_id, r.usable_capacity, fg.precalled_at,
              fg.precall_decision_status, fg.precall_decision_reason,
              fg.precall_dispatch_reason,
              fg.precall_decision_at, fg.precall_predicted_boarding_at,
              fg.precall_adaptive_lead_minutes, fg.precall_gate_id,
              fg.precall_adaptive_base_lead_minutes,
              fg.precall_gate_travel_lead_minutes, fg.precall_effective_lead_minutes,
              fg.precall_boarding_window_lower_at, fg.precall_boarding_window_upper_at,
              COALESCE(r.gate_id, MIN(p.gate_id), '') AS gate_id,
              COALESCE(MAX(rotation_gate.label), MIN(product_gate.label), '') AS gate_label,
              r.operational_note,
              r.called_at, r.departed_at, r.landed_at, r.completed_at,
              r.planned_boarding_at, r.planned_departure_at, r.planned_landing_at,
              r.planned_completion_at, r.predicted_boarding_at, r.predicted_departure_at,
              r.predicted_landing_at, r.predicted_completion_at, r.prediction_quality,
              r.prediction_lower_minutes, r.prediction_upper_minutes, r.prediction_updated_at,
              r.forecast_assumed_aircraft_id, r.turnaround_boarding_minutes,
              r.dispatch_plan_id, r.dispatch_plan_revision, r.dispatch_batch_id,
              (SELECT snapshot.operation_day_version
                 FROM forecast_snapshots snapshot
                WHERE snapshot.rotation_id = r.id
                  AND snapshot.dispatch_plan_revision = r.dispatch_plan_revision
                ORDER BY snapshot.captured_at DESC, snapshot.id DESC
                LIMIT 1) AS dispatch_operation_day_version,
              r.dispatch_order, r.dispatch_wave, r.dispatch_lane_id,
              r.dispatch_group_ids_json, r.dispatch_occupied_seats,
              r.dispatch_available_seats, r.dispatch_commitment_level,
              r.dispatch_decision_reasons_json, r.dispatch_confirmed_overtake_count,
              r.dispatch_projected_overtake_count,
              r.dispatch_unplanned_reason,
              r.turnaround_deboarding_minutes, r.turnaround_buffer_minutes,
              r.turnaround_boarding_source, r.turnaround_deboarding_source,
              r.turnaround_buffer_source,
              a.registration AS aircraft_registration,
              r.pilot_id, assigned_pilot.operational_code AS pilot_operational_code,
              (SELECT available_pilot.id FROM pilots available_pilot
                WHERE available_pilot.operation_day_id = r.operation_day_id
                  AND available_pilot.active = 1 AND available_pilot.paused = 0
                  AND NOT EXISTS (
                    SELECT 1 FROM rotations pilot_rotation
                     WHERE pilot_rotation.operation_day_id = r.operation_day_id
                       AND pilot_rotation.pilot_id = available_pilot.id
                       AND pilot_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                  )
                ORDER BY available_pilot.operational_code LIMIT 1) AS suggested_pilot_id,
              (SELECT available_pilot.operational_code FROM pilots available_pilot
                WHERE available_pilot.operation_day_id = r.operation_day_id
                  AND available_pilot.active = 1 AND available_pilot.paused = 0
                  AND NOT EXISTS (
                    SELECT 1 FROM rotations pilot_rotation
                     WHERE pilot_rotation.operation_day_id = r.operation_day_id
                       AND pilot_rotation.pilot_id = available_pilot.id
                       AND pilot_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                  )
                ORDER BY available_pilot.operational_code LIMIT 1) AS suggested_pilot_operational_code,
              (SELECT candidate.id FROM resource_group_memberships membership
                JOIN aircraft candidate ON candidate.id = membership.aircraft_id
               WHERE membership.operation_day_id = r.operation_day_id
                 AND membership.resource_group_id = fg.resource_group_id
                 AND membership.active_until IS NULL
                 AND candidate.operational_state IN ('AVAILABLE', 'BOARDING', 'IN_FLIGHT', 'LANDED', 'TURNAROUND')
                 AND candidate.operational_interrupted = 0
                 AND candidate.passenger_seats >= (
                   SELECT COUNT(*) FROM rotation_tickets capacity_rt
                    WHERE capacity_rt.rotation_id = r.id AND capacity_rt.released_at IS NULL
                 )
               ORDER BY
                 CASE WHEN candidate.operational_state = 'AVAILABLE' THEN 0 ELSE 1 END,
                 COALESCE((
                   SELECT candidate_rotation.predicted_completion_at
                     FROM rotations candidate_rotation
                    WHERE candidate_rotation.operation_day_id = membership.operation_day_id
                      AND candidate_rotation.aircraft_id = candidate.id
                      AND candidate_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                    ORDER BY candidate_rotation.predicted_completion_at DESC
                    LIMIT 1
                 ), '9999-12-31T23:59:59.999Z'),
                 candidate.passenger_seats,
                 candidate.registration
               LIMIT 1) AS suggested_aircraft_id,
              (SELECT candidate.registration FROM resource_group_memberships membership
                JOIN aircraft candidate ON candidate.id = membership.aircraft_id
               WHERE membership.operation_day_id = r.operation_day_id
                 AND membership.resource_group_id = fg.resource_group_id
                 AND membership.active_until IS NULL
                 AND candidate.operational_state IN ('AVAILABLE', 'BOARDING', 'IN_FLIGHT', 'LANDED', 'TURNAROUND')
                 AND candidate.operational_interrupted = 0
                 AND candidate.passenger_seats >= (
                   SELECT COUNT(*) FROM rotation_tickets capacity_rt
                    WHERE capacity_rt.rotation_id = r.id AND capacity_rt.released_at IS NULL
                 )
               ORDER BY
                 CASE WHEN candidate.operational_state = 'AVAILABLE' THEN 0 ELSE 1 END,
                 COALESCE((
                   SELECT candidate_rotation.predicted_completion_at
                     FROM rotations candidate_rotation
                    WHERE candidate_rotation.operation_day_id = membership.operation_day_id
                      AND candidate_rotation.aircraft_id = candidate.id
                      AND candidate_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                    ORDER BY candidate_rotation.predicted_completion_at DESC
                    LIMIT 1
                 ), '9999-12-31T23:59:59.999Z'),
                 candidate.passenger_seats,
                 candidate.registration
               LIMIT 1) AS suggested_aircraft_registration,
              MIN(tg.id) AS ticket_group_id, MIN(tg.deferral_count) AS deferral_count,
              COUNT(rt.ticket_id) AS ticket_count,
              CASE
                WHEN COUNT(rt.ticket_id) = 0
                  OR SUM(CASE WHEN t.weight_class = 'NOT_CAPTURED' THEN 1 ELSE 0 END) > 0
                THEN NULL
                ELSE SUM(CASE t.weight_class
                  WHEN 'CHILD' THEN od.child_reference_weight_kg
                  WHEN 'NORMAL' THEN od.normal_reference_weight_kg
                  WHEN 'HEAVY' THEN od.heavy_reference_weight_kg
                  WHEN 'INDIVIDUAL' THEN t.individual_weight_kg
                  ELSE NULL
                END)
              END AS estimated_passenger_payload_kg,
              COALESCE(MIN(p.code), 'RUND') AS product_code,
              COALESCE(MIN(p.name), 'Rundflug') AS product_name,
              COALESCE(MIN(p.reference_duration_minutes), 20) AS reference_duration_minutes,
              COALESCE(a.passenger_seats, MIN(p.reference_capacity), rotation_rg.reference_capacity)
                AS baseline_capacity,
              (SELECT json_group_array(json_object(
                'id', attendance_ticket.id,
                'status', attendance_ticket.status,
                'attendanceStatus', attendance_ticket.attendance_status
              ))
                FROM rotation_tickets attendance_rt
                JOIN tickets attendance_ticket ON attendance_ticket.id = attendance_rt.ticket_id
               WHERE attendance_rt.rotation_id = r.id AND attendance_rt.released_at IS NULL) AS tickets_json
              ,(SELECT json_group_array(json_object(
                  'id', grouped_tickets.ticket_group_id,
                  'communicationNumber', grouped_tickets.communication_number,
                  'soldAt', grouped_tickets.sold_at,
                  'ticketCount', grouped_tickets.ticket_count,
                  'presentCount', grouped_tickets.present_count,
                  'partNumber', grouped_tickets.part_number,
                  'partCount', grouped_tickets.part_count
                ))
                  FROM (
                    SELECT grouped_ticket.ticket_group_id,
                           grouped_group.communication_number,
                           grouped_group.sold_at,
                           grouped_part.part_number,
                           grouped_part.part_count,
                           COUNT(*) AS ticket_count,
                           SUM(CASE WHEN grouped_ticket.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END)
                             AS present_count
                      FROM rotation_tickets grouped_rt
                      JOIN tickets grouped_ticket ON grouped_ticket.id = grouped_rt.ticket_id
                      JOIN ticket_groups grouped_group ON grouped_group.id = grouped_ticket.ticket_group_id
                      JOIN booking_group_parts grouped_part
                        ON grouped_part.ticket_group_id = grouped_ticket.ticket_group_id
                       AND grouped_part.rotation_id = grouped_rt.rotation_id
                     WHERE grouped_rt.rotation_id = r.id AND grouped_rt.released_at IS NULL
                     GROUP BY grouped_ticket.ticket_group_id, grouped_group.communication_number,
                              grouped_group.sold_at, grouped_part.part_number,
                              grouped_part.part_count
                  ) grouped_tickets) AS booking_groups_json
         FROM rotations r
         JOIN operation_days od ON od.id = r.operation_day_id
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rotation_rg ON rotation_rg.id = fg.resource_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
         LEFT JOIN pilots assigned_pilot ON assigned_pilot.id = r.pilot_id
         LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         LEFT JOIN tickets t ON t.id = rt.ticket_id
         LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         LEFT JOIN products p ON p.id = tg.product_id
         LEFT JOIN gates rotation_gate ON rotation_gate.id = r.gate_id
         LEFT JOIN gates product_gate ON product_gate.id = p.gate_id
        WHERE r.operation_day_id = ?1 AND r.status <> 'CANCELED'
        GROUP BY r.id
        ORDER BY CASE WHEN r.status = 'DRAFT' THEN 1 ELSE 0 END,
                 COALESCE(fg.queue_position, fg.communication_number), fg.communication_number`,
        ),
      )
        .bind(eventId)
        .all<{
          id: string;
          version: number;
          flight_group_id: string;
          resource_group_id: string;
          resource_group_short_code: string;
          communication_number: number;
          queue_position: number;
          status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
          precalled_at: string | null;
          precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
          precall_decision_reason:
            | "ELIGIBLE"
            | "DISABLED"
            | "OPERATIONS_BLOCKED"
            | "NOT_QUEUE_FRONT"
            | "ALREADY_PRECALLED"
            | "NO_FORECAST_CAPACITY"
            | "NO_FITTING_AIRCRAFT"
            | "TOO_EARLY"
            | null;
          precall_dispatch_reason:
            | "NOT_IN_NEAR_DISPATCH_BATCH"
            | "GATE_CAPACITY_COVERED"
            | "WAITING_FOR_PRODUCT_FAIRNESS"
            | "WAITING_FOR_FITTING_LANE"
            | "COMMITMENT_LOCKED"
            | "DISPATCH_PLAN_STALE"
            | null;
          precall_decision_at: string | null;
          precall_predicted_boarding_at: string | null;
          precall_adaptive_lead_minutes: number | null;
          precall_gate_id: string | null;
          precall_adaptive_base_lead_minutes: number | null;
          precall_gate_travel_lead_minutes: number | null;
          precall_effective_lead_minutes: number | null;
          precall_boarding_window_lower_at: string | null;
          precall_boarding_window_upper_at: string | null;
          gate_id: string;
          gate_label: string;
          operational_note: string;
          aircraft_id: string | null;
          aircraft_registration: string | null;
          pilot_id: string | null;
          pilot_operational_code: string | null;
          suggested_pilot_id: string | null;
          suggested_pilot_operational_code: string | null;
          suggested_aircraft_id: string | null;
          suggested_aircraft_registration: string | null;
          ticket_group_id: string;
          deferral_count: number;
          ticket_count: number;
          baseline_capacity: number;
          usable_capacity: number | null;
          estimated_passenger_payload_kg: number | null;
          product_code: string;
          product_name: string;
          reference_duration_minutes: number;
          called_at: string | null;
          departed_at: string | null;
          landed_at: string | null;
          completed_at: string | null;
          planned_boarding_at: string | null;
          planned_departure_at: string | null;
          planned_landing_at: string | null;
          planned_completion_at: string | null;
          predicted_boarding_at: string | null;
          predicted_departure_at: string | null;
          predicted_landing_at: string | null;
          predicted_completion_at: string | null;
          prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
          prediction_lower_minutes: number | null;
          prediction_upper_minutes: number | null;
          prediction_updated_at: string | null;
          forecast_assumed_aircraft_id: string | null;
          dispatch_plan_id: string | null;
          dispatch_plan_revision: string | null;
          dispatch_batch_id: string | null;
          dispatch_operation_day_version: number | null;
          dispatch_order: number | null;
          dispatch_wave: number | null;
          dispatch_lane_id: string | null;
          dispatch_group_ids_json: string;
          dispatch_occupied_seats: number | null;
          dispatch_available_seats: number | null;
          dispatch_commitment_level: "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE" | null;
          dispatch_decision_reasons_json: string;
          dispatch_confirmed_overtake_count: number;
          dispatch_projected_overtake_count: number;
          dispatch_unplanned_reason:
            | "NO_FORECAST_CAPACITY"
            | "WAITING_FOR_FITTING_LANE"
            | "WAITING_FOR_PRODUCT_FAIRNESS"
            | "NOT_IN_NEAR_DISPATCH_BATCH"
            | "COMMITMENT_LOCKED"
            | "ATTENDANCE_MISSING"
            | "ATTENDANCE_CLARIFICATION"
            | "UNKNOWN_RESOURCE_RETURN"
            | null;
          turnaround_boarding_minutes: number | null;
          turnaround_deboarding_minutes: number | null;
          turnaround_buffer_minutes: number | null;
          turnaround_boarding_source: string | null;
          turnaround_deboarding_source: string | null;
          turnaround_buffer_source: string | null;
          tickets_json: string;
          booking_groups_json: string;
        }>(),
    () =>
      context.env.DB.prepare(
        `WITH segment_stats AS (
           SELECT segment_ticket.ticket_group_id, segment_rotation.id AS rotation_id,
                  segment_rotation.status,
                  COALESCE(segment_group.queue_position, segment_group.communication_number)
                    AS segment_order,
                  segment_group.communication_number,
                  segment_group.precalled_at,
                  COUNT(*) AS ticket_count,
                  SUM(CASE WHEN segment_ticket.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END)
                    AS present_count
             FROM rotation_tickets segment_assignment
             JOIN tickets segment_ticket ON segment_ticket.id = segment_assignment.ticket_id
             JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
             JOIN flight_groups segment_group ON segment_group.id = segment_rotation.flight_group_id
            WHERE segment_assignment.released_at IS NULL
              AND segment_rotation.operation_day_id = ?1
              AND segment_rotation.status <> 'CANCELED'
            GROUP BY segment_ticket.ticket_group_id, segment_rotation.id, segment_rotation.status,
                     segment_group.queue_position, segment_group.communication_number,
                     segment_group.precalled_at
         ), ranked_segments AS (
           SELECT segment_stats.*,
                  ROW_NUMBER() OVER (
                    PARTITION BY ticket_group_id
                    ORDER BY segment_order, communication_number, rotation_id
                  ) AS segment_index,
                  COUNT(*) OVER (PARTITION BY ticket_group_id) AS segment_count
             FROM segment_stats
         ), next_draft_segments AS (
           SELECT ranked_drafts.*
             FROM (
               SELECT ranked_segments.*,
                      ROW_NUMBER() OVER (
                        PARTITION BY ticket_group_id ORDER BY segment_index
                      ) AS draft_rank
                 FROM ranked_segments
                WHERE status = 'DRAFT'
             ) ranked_drafts
            WHERE ranked_drafts.draft_rank = 1
         )
         SELECT tg.id, tg.communication_number, tg.queue_sequence, tg.status,
                active_recall.id AS recall_id,
                active_recall.sequence AS recall_sequence,
                active_recall.started_at AS recall_started_at,
                active_recall.expires_at AS recall_expires_at,
                COALESCE((
                  SELECT MAX(recall_count.sequence)
                    FROM ticket_group_recalls recall_count
                   WHERE recall_count.ticket_group_id = tg.id
                ), 0) AS recall_count,
                p.id AS product_id, p.code AS product_code,
                p.name AS product_name, p.resource_group_id, p.gate_id,
                g.label AS gate_label,
                COUNT(t.id) AS ticket_count,
                SUM(CASE WHEN t.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS present_count,
                next_segment.ticket_count AS next_segment_ticket_count,
                next_segment.present_count AS next_segment_present_count,
                next_segment.segment_index,
                next_segment.segment_count,
                next_segment.precalled_at
           FROM ticket_groups tg
           JOIN products p ON p.id = tg.product_id
           JOIN gates g ON g.id = p.gate_id
           JOIN tickets t ON t.ticket_group_id = tg.id
           JOIN next_draft_segments next_segment ON next_segment.ticket_group_id = tg.id
           LEFT JOIN ticket_group_recalls active_recall
             ON active_recall.ticket_group_id = tg.id
            AND active_recall.ended_at IS NULL
            AND active_recall.expires_at > ?2
          WHERE tg.operation_day_id = ?1 AND tg.status IN ('QUEUED', 'PRESENT', 'MISSING')
          GROUP BY tg.id, p.id, next_segment.ticket_count, next_segment.present_count,
                   next_segment.segment_index, next_segment.segment_count,
                   next_segment.precalled_at,
                   active_recall.id, active_recall.sequence, active_recall.started_at,
                   active_recall.expires_at
          ORDER BY tg.queue_sequence`,
      )
        .bind(eventId, projectionReadAt)
        .all<{
          id: string;
          communication_number: number;
          queue_sequence: number;
          status: string;
          recall_count: number;
          recall_id: string | null;
          recall_sequence: number | null;
          recall_started_at: string | null;
          recall_expires_at: string | null;
          product_id: string;
          product_code: string;
          product_name: string;
          resource_group_id: string;
          gate_id: string;
          gate_label: string;
          ticket_count: number;
          present_count: number;
          next_segment_ticket_count: number;
          next_segment_present_count: number;
          segment_index: number;
          segment_count: number;
          precalled_at: string | null;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT reserved_group.value AS ticket_group_id, lease.operator_account_id, lease.device_id
           FROM dispatch_recommendation_leases lease
           JOIN json_each(lease.ticket_group_ids_json) reserved_group
          WHERE lease.operation_day_id = ?1 AND lease.status = 'ACTIVE'
            AND lease.expires_at > ?2
          ORDER BY lease.acquired_at, lease.id`,
      )
        .bind(eventId, projectionReadAt)
        .all<{
          ticket_group_id: string;
          operator_account_id: string;
          device_id: string;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT (julianday(landed_at) - julianday(departed_at)) * 1440.0 AS duration_minutes
         FROM rotations
        WHERE operation_day_id = ?1 AND departed_at IS NOT NULL AND landed_at IS NOT NULL
        ORDER BY landed_at DESC LIMIT 12`,
      )
        .bind(eventId)
        .all<{ duration_minutes: number }>(),
    () =>
      context.env.DB.prepare(
        `SELECT m.resource_group_id, a.passenger_seats, a.refuel_planned,
                a.operational_state, a.operational_interrupted
           FROM aircraft a
         JOIN resource_group_memberships m ON m.aircraft_id = a.id
        WHERE m.operation_day_id = ?1 AND m.active_until IS NULL`,
      )
        .bind(eventId)
        .all<{
          resource_group_id: string;
          passenger_seats: number;
          refuel_planned: number;
          operational_state: string;
          operational_interrupted: number;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT a.id, a.version, a.registration, a.aircraft_type, a.passenger_seats,
              a.maximum_passenger_payload_kg, a.operational_state,
              COALESCE(a.operational_state_changed_at, a.updated_at) AS operational_state_changed_at,
              a.refuel_planned, a.rotations_since_refuel, a.refuel_reminder_threshold,
              a.operational_interrupted,
              m.resource_group_id, rg.name AS resource_group_name,
              rg.short_code AS resource_group_short_code,
              m.current_pilot_id, current_pilot.operational_code AS current_pilot_operational_code,
              (SELECT b.expected_review_at FROM operational_blocks b
                WHERE b.operation_day_id = m.operation_day_id AND b.scope_type = 'AIRCRAFT'
                  AND b.scope_id = a.id AND b.status = 'ACTIVE'
                ORDER BY b.started_at DESC LIMIT 1) AS expected_review_at
         FROM aircraft a
         LEFT JOIN resource_group_memberships m ON m.aircraft_id = a.id
          AND m.operation_day_id = ?1 AND m.active_until IS NULL
         LEFT JOIN resource_groups rg ON rg.id = m.resource_group_id
         LEFT JOIN pilots current_pilot ON current_pilot.id = m.current_pilot_id
        ORDER BY a.registration`,
      )
        .bind(eventId)
        .all<{
          id: string;
          version: number;
          registration: string;
          aircraft_type: string;
          passenger_seats: number;
          maximum_passenger_payload_kg: number | null;
          operational_state: string;
          operational_state_changed_at: string;
          refuel_planned: number;
          rotations_since_refuel: number;
          refuel_reminder_threshold: number;
          operational_interrupted: number;
          resource_group_id: string | null;
          resource_group_name: string | null;
          resource_group_short_code: string | null;
          current_pilot_id: string | null;
          current_pilot_operational_code: string | null;
          expected_review_at: string | null;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT p.id, p.operational_code, p.operational_note, p.active, p.paused,
              p.pause_expected_review_at,
              (SELECT r.id FROM rotations r WHERE r.operation_day_id = p.operation_day_id
                AND r.pilot_id = p.id AND r.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                ORDER BY r.updated_at DESC LIMIT 1) AS current_rotation_id,
              (SELECT fg.communication_number FROM rotations r
                JOIN flight_groups fg ON fg.id = r.flight_group_id
                WHERE r.operation_day_id = p.operation_day_id AND r.pilot_id = p.id
                  AND r.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                ORDER BY r.updated_at DESC LIMIT 1) AS current_communication_number
         FROM pilots p WHERE p.operation_day_id = ?1 ORDER BY p.operational_code`,
      )
        .bind(eventId)
        .all<{
          id: string;
          operational_code: string;
          operational_note: string;
          active: number;
          paused: number;
          pause_expected_review_at: string | null;
          current_rotation_id: string | null;
          current_communication_number: number | null;
        }>(),
    () =>
      withGateDisplayFilterFallback((mode) => {
        const displayFilterProjection =
          mode === "current"
            ? "g.display_filter_json"
            : `'${EMPTY_GATE_DISPLAY_FILTER_JSON}' AS display_filter_json`;
        return context.env.DB.prepare(
          `SELECT g.id, g.label, g.gate_type, g.active, g.sort_order,
                g.travel_lead_minutes, ${displayFilterProjection},
                COALESCE((SELECT json_group_array(rg.id) FROM resource_groups rg
                  WHERE rg.operation_day_id = g.operation_day_id AND rg.gate_id = g.id), '[]')
                  AS assigned_resource_group_ids_json
             FROM gates g WHERE g.operation_day_id = ?1 ORDER BY g.sort_order, g.label`,
        )
          .bind(eventId)
          .all<{
            id: string;
            label: string;
            gate_type: "FLIGHT_LINE" | "BOARDING" | "DISPLAY_ONLY";
            active: number;
            sort_order: number;
            travel_lead_minutes: number;
            display_filter_json: string;
            assigned_resource_group_ids_json: string;
          }>();
      }),
    () =>
      context.env.DB.prepare(
        `SELECT rg.id, rg.version, rg.name, rg.short_code, rg.status, rg.operational_note,
              rg.gate_id, g.label AS gate_label,
              rg.reference_capacity,
              rg.compatible_aircraft_types_json, rg.automatic_precall_enabled,
              COALESCE((SELECT json_group_array(m.aircraft_id)
                FROM resource_group_memberships m
               WHERE m.operation_day_id = rg.operation_day_id
                 AND m.resource_group_id = rg.id AND m.active_until IS NULL), '[]') AS aircraft_ids_json
         FROM resource_groups rg JOIN gates g ON g.id = rg.gate_id
        WHERE rg.operation_day_id = ?1 ORDER BY rg.name`,
      )
        .bind(eventId)
        .all<{
          id: string;
          version: number;
          name: string;
          short_code: string;
          status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
          operational_note: string;
          gate_id: string;
          gate_label: string;
          reference_capacity: number;
          compatible_aircraft_types_json: string;
          automatic_precall_enabled: number;
          aircraft_ids_json: string;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT plan.id, plan.version, plan.scope_type, plan.scope_id,
                plan.constraint_kind, plan.effect_mode, plan.duration_multiplier_percent,
                plan.start_mode, plan.earliest_start_at,
                plan.latest_start_at, plan.after_rotation_id,
                plan.minimum_duration_minutes, plan.typical_duration_minutes,
                plan.maximum_duration_minutes, plan.status, plan.public_note,
                plan.created_at, plan.updated_at, plan.activated_at, plan.cleared_at,
                plan.canceled_at, plan.recurring_rule_id, plan.recurrence_sequence,
                after_rotation.status AS after_rotation_status
           FROM planned_operational_constraints plan
           LEFT JOIN rotations after_rotation ON after_rotation.id = plan.after_rotation_id
          WHERE plan.operation_day_id = ?1
          ORDER BY
            CASE plan.status WHEN 'ACTIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
            COALESCE(plan.earliest_start_at, plan.created_at), plan.created_at`,
      )
        .bind(eventId)
        .all<{
          id: string;
          version: number;
          scope_type: "EVENT" | "RESOURCE_GROUP" | "AIRCRAFT" | "PILOT";
          scope_id: string;
          constraint_kind:
            | "PAUSE"
            | "REFUELING"
            | "FLIGHT_SHOW"
            | "WEATHER"
            | "TECHNICAL"
            | "OTHER";
          effect_mode: "BLOCKING" | "SLOWDOWN";
          duration_multiplier_percent: number | null;
          start_mode: "TIME_WINDOW" | "AFTER_CURRENT_ROTATION";
          earliest_start_at: string | null;
          latest_start_at: string | null;
          after_rotation_id: string | null;
          minimum_duration_minutes: number;
          typical_duration_minutes: number;
          maximum_duration_minutes: number;
          status: "PLANNED" | "ACTIVE" | "CLEARED" | "CANCELED";
          public_note: string;
          created_at: string;
          updated_at: string;
          activated_at: string | null;
          cleared_at: string | null;
          canceled_at: string | null;
          recurring_rule_id: string | null;
          recurrence_sequence: number | null;
          after_rotation_status: string | null;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT rule.id, rule.operation_day_id, rule.version, rule.scope_type, rule.scope_id,
                rule.operation_kind, rule.trigger_metric, rule.interval_value,
                rule.progress_value, rule.minimum_duration_minutes,
                rule.typical_duration_minutes, rule.maximum_duration_minutes,
                rule.status, rule.sequence_number, rule.reason, rule.last_reset_at,
                rule.created_at, rule.updated_at,
                (SELECT plan.id FROM planned_operational_constraints plan
                  WHERE plan.recurring_rule_id = rule.id
                    AND plan.status IN ('PLANNED', 'ACTIVE')
                  ORDER BY plan.recurrence_sequence DESC LIMIT 1) AS open_plan_id
           FROM recurring_operational_rules rule
          WHERE rule.operation_day_id = ?1
          ORDER BY CASE rule.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
                   rule.scope_type, rule.scope_id, rule.operation_kind`,
      )
        .bind(eventId)
        .all<{
          id: string;
          operation_day_id: string;
          version: number;
          scope_type: "AIRCRAFT" | "PILOT";
          scope_id: string;
          operation_kind: "PAUSE" | "REFUELING";
          trigger_metric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
          interval_value: number;
          progress_value: number;
          minimum_duration_minutes: number;
          typical_duration_minutes: number;
          maximum_duration_minutes: number;
          status: "ACTIVE" | "DISABLED";
          sequence_number: number;
          reason: string;
          last_reset_at: string;
          created_at: string;
          updated_at: string;
          open_plan_id: string | null;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1
              AND t.status NOT IN ('COMPLETED', 'CANCELED', 'NO_SHOW')) AS open_tickets,
          (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1) AS sold_tickets,
          (SELECT COUNT(*) FROM rotations WHERE operation_day_id = ?1 AND status = 'COMPLETED') AS completed_rotations,
          (SELECT COUNT(*) FROM rotations WHERE operation_day_id = ?1
            AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')) AS active_rotations,
          (SELECT ROUND(AVG((julianday(departed_at) - julianday(called_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND called_at IS NOT NULL AND departed_at IS NOT NULL)
            AS average_boarding_minutes,
          (SELECT ROUND(AVG((julianday(landed_at) - julianday(departed_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND departed_at IS NOT NULL AND landed_at IS NOT NULL)
            AS average_flight_minutes,
          (SELECT ROUND(AVG((julianday(completed_at) - julianday(landed_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND landed_at IS NOT NULL AND completed_at IS NOT NULL)
            AS average_turnaround_minutes,
          (SELECT ROUND(AVG((julianday(completed_at) - julianday(called_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND called_at IS NOT NULL AND completed_at IS NOT NULL)
            AS average_rotation_minutes,
          (SELECT ROUND(AVG((julianday(r.called_at) - julianday(tg.sold_at)) * 1440.0), 1)
            FROM ticket_groups tg
            JOIN tickets t ON t.ticket_group_id = tg.id
            JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
            JOIN rotations r ON r.id = rt.rotation_id
            WHERE tg.operation_day_id = ?1 AND r.called_at IS NOT NULL) AS average_wait_minutes,
          (SELECT COALESCE(SUM(CASE WHEN t.status <> 'CANCELED' THEN t.price_cents ELSE 0 END), 0)
            FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1) AS informational_revenue_cents,
          (SELECT COUNT(*) FROM paired_devices WHERE operation_day_id = ?1 AND active = 1
            AND last_seen_at >= ?2) AS active_devices,
          (SELECT COUNT(*) FROM web_push_subscriptions WHERE operation_day_id = ?1
            AND status = 'ACTIVE' AND delete_after > ?3) AS active_push_subscriptions`,
      )
        .bind(eventId, new Date(Date.now() - 120_000).toISOString(), new Date().toISOString())
        .first<{
          open_tickets: number;
          sold_tickets: number;
          completed_rotations: number;
          active_rotations: number;
          average_boarding_minutes: number | null;
          average_flight_minutes: number | null;
          average_turnaround_minutes: number | null;
          average_rotation_minutes: number | null;
          average_wait_minutes: number | null;
          informational_revenue_cents: number;
          active_devices: number;
          active_push_subscriptions: number;
        }>(),
  ] as const);

  let assistClaims: Array<{
    aircraft_id: string;
    operator_account_id: string;
    login_code: string;
    claimed_at: string;
    expires_at: string;
    revision: number;
  }> = [];
  try {
    const claims = await context.env.DB.prepare(
      `SELECT claim.aircraft_id, claim.operator_account_id, account.login_code,
              claim.claimed_at, claim.expires_at, claim.revision
         FROM flight_line_assist_claims claim
         JOIN operator_accounts account ON account.id = claim.operator_account_id
        WHERE claim.operation_day_id = ?1 AND claim.expires_at > ?2
        ORDER BY claim.claimed_at`,
    )
      .bind(eventId, new Date().toISOString())
      .all<{
        aircraft_id: string;
        operator_account_id: string;
        login_code: string;
        claimed_at: string;
        expires_at: string;
        revision: number;
      }>();
    assistClaims = claims.results;
  } catch (cause) {
    if (!String(cause).includes("no such table: flight_line_assist_claims")) throw cause;
  }

  const actualDurations = [...durationRows.results].reverse().map((row) => row.duration_minutes);
  const activePilotCount = pilotRows.results.filter(
    (pilot) => pilot.active === 1 && pilot.paused === 0,
  ).length;
  const forecastReadAt = new Date().toISOString();
  const forecastReferenceMs = Date.parse(forecastReadAt);
  const operationsEnd = eventRow.operations_end_at ? Date.parse(eventRow.operations_end_at) : 0;
  const operationsEndMinutes = Math.max(0, (operationsEnd - forecastReferenceMs) / 60_000);
  const dispatchReservationByGroupId = new Map<string, "OWN" | "OTHER">();
  for (const lease of dispatchLeaseRows.results) {
    const reservation =
      device.accountId !== null &&
      lease.operator_account_id === device.accountId &&
      lease.device_id === device.id
        ? "OWN"
        : "OTHER";
    if (reservation === "OWN" || !dispatchReservationByGroupId.has(lease.ticket_group_id)) {
      dispatchReservationByGroupId.set(lease.ticket_group_id, reservation);
    }
  }

  const response = context.json({
    currentDeviceRole: device.role,
    event: rowToSnapshot(eventRow),
    products: products.results.map((product) => {
      const effectiveTurnaroundProfile = resolveTurnaroundProfile({
        event: {
          sourceId: eventId,
          boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
          deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
          bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
        },
        product: {
          sourceId: product.id,
          boardingMinutes: product.planned_boarding_minutes_override,
          deboardingMinutes: product.planned_deboarding_minutes_override,
          bufferMinutes: product.planned_buffer_minutes_override,
        },
      });
      const assignedGroupAircraft = aircraftRows.results.filter(
        (aircraft) => aircraft.resource_group_id === product.resource_group_id,
      );
      const operationalGroupAircraft = assignedGroupAircraft.filter(
        (aircraft) =>
          !["INACTIVE", "PAUSED", "REFUELING"].includes(aircraft.operational_state) &&
          aircraft.operational_interrupted === 0,
      );
      const allGroupAircraftSeats = assignedGroupAircraft.map(
        (aircraft) => aircraft.passenger_seats,
      );
      const groupAircraftSeats = operationalGroupAircraft
        .map((aircraft) => aircraft.passenger_seats)
        .slice(0, activePilotCount);
      const effectiveReferenceCapacity = Math.max(
        1,
        deriveResourceGroupCapacity(allGroupAircraftSeats),
      );
      const activeAircraft = groupAircraftSeats.length;
      const queueSequence = Math.max(
        1,
        Math.ceil(product.queued_tickets / product.reference_capacity),
      );
      const duration = estimateDuration({
        referenceMinutes:
          product.reference_duration_minutes + effectiveTurnaroundProfile.totalGroundMinutes,
        actualDurationsMinutes: actualDurations,
        interrupted:
          product.resource_group_status !== "ACTIVE" ||
          eventRow.emergency_mode === 1 ||
          eventRow.operational_interrupted === 1,
        activeCapacity: activeAircraft,
      });
      const fallbackForecast = forecastQueueWindows({ queueSequence, activeAircraft, duration });
      const firstQueuedRotation = rotations.results.find(
        (rotation) =>
          rotation.resource_group_id === product.resource_group_id &&
          rotation.status === "DRAFT" &&
          rotation.prediction_lower_minutes !== null &&
          rotation.prediction_upper_minutes !== null,
      );
      const preOperationsOffset = eventRow.operations_start_at
        ? Math.max(0, (Date.parse(eventRow.operations_start_at) - forecastReferenceMs) / 60_000)
        : 0;
      const forecast = firstQueuedRotation
        ? {
            lowerMinutes: firstQueuedRotation.prediction_lower_minutes ?? 0,
            upperMinutes: firstQueuedRotation.prediction_upper_minutes ?? 0,
            quality: firstQueuedRotation.prediction_quality ?? fallbackForecast.quality,
          }
        : preOperationsOffset > 0
          ? {
              lowerMinutes: Math.max(0, Math.round(preOperationsOffset - 5)),
              upperMinutes: Math.round(preOperationsOffset + 5),
              quality: "CHANGING" as const,
            }
          : fallbackForecast;
      const forecastMidpointMinutes = (forecast.lowerMinutes + forecast.upperMinutes) / 2;
      const storedForecastCenterMs = firstQueuedRotation?.predicted_boarding_at
        ? Date.parse(firstQueuedRotation.predicted_boarding_at)
        : Number.NaN;
      const nextBoardingWindowLowerAt =
        forecast.quality === "UNCERTAIN"
          ? null
          : new Date(
              Number.isFinite(storedForecastCenterMs)
                ? storedForecastCenterMs +
                    (forecast.lowerMinutes - forecastMidpointMinutes) * 60_000
                : forecastReferenceMs + forecast.lowerMinutes * 60_000,
            ).toISOString();
      const nextBoardingWindowUpperAt =
        forecast.quality === "UNCERTAIN"
          ? null
          : new Date(
              Date.parse(nextBoardingWindowLowerAt ?? new Date(forecastReferenceMs).toISOString()) +
                Math.max(0, forecast.upperMinutes - forecast.lowerMinutes) * 60_000,
            ).toISOString();
      const resourceGroupRotations = rotations.results.filter(
        (rotation) => rotation.resource_group_id === product.resource_group_id,
      );
      const blockingUnprojectedQueue = resourceGroupRotations.some(
        (rotation) =>
          rotation.status === "DRAFT" &&
          rotation.ticket_count > 0 &&
          rotation.predicted_completion_at === null &&
          !["ATTENDANCE_MISSING", "ATTENDANCE_CLARIFICATION"].includes(
            rotation.dispatch_unplanned_reason ?? "",
          ),
      );
      const availablePilots = pilotRows.results
        .flatMap((pilot) => {
          if (pilot.active !== 1) return [];
          const activeRotation = pilot.current_rotation_id
            ? resourceGroupRotations.find((rotation) => rotation.id === pilot.current_rotation_id)
            : undefined;
          const availableAt = activeRotation?.predicted_completion_at
            ? Date.parse(activeRotation.predicted_completion_at)
            : pilot.paused === 1
              ? pilot.pause_expected_review_at
                ? Date.parse(pilot.pause_expected_review_at)
                : Number.NaN
              : forecastReferenceMs;
          if (!Number.isFinite(availableAt)) return [];
          return [
            {
              id: pilot.id,
              availableMinutes: Math.max(0, (availableAt - forecastReferenceMs) / 60_000),
            },
          ];
        })
        .sort(
          (left, right) =>
            left.availableMinutes - right.availableMinutes || left.id.localeCompare(right.id),
        );
      const compatibleAircraftTypes = new Set(
        JSON.parse(
          resourceGroupRows.results.find((group) => group.id === product.resource_group_id)
            ?.compatible_aircraft_types_json ?? "[]",
        ) as string[],
      );
      const capacityLanes =
        eventRow.operational_interrupted === 1 ||
        product.resource_group_status !== "ACTIVE" ||
        blockingUnprojectedQueue
          ? []
          : fleetRows.results
              .filter(
                (aircraft) =>
                  aircraft.resource_group_id === product.resource_group_id &&
                  aircraft.operational_state !== "INACTIVE" &&
                  (compatibleAircraftTypes.size === 0 ||
                    compatibleAircraftTypes.has(aircraft.aircraft_type)),
              )
              .flatMap((aircraft) => {
                const assignedRotations = resourceGroupRotations.filter(
                  (rotation) =>
                    rotation.aircraft_id === aircraft.id ||
                    rotation.forecast_assumed_aircraft_id === aircraft.id,
                );
                const unknownReturn =
                  (aircraft.operational_interrupted === 1 ||
                    ["PAUSED", "REFUELING"].includes(aircraft.operational_state)) &&
                  aircraft.expected_review_at === null &&
                  !assignedRotations.some((rotation) => rotation.predicted_completion_at !== null);
                if (unknownReturn) return [];
                const projectedCompletions = assignedRotations.flatMap((rotation) => {
                  if (!rotation.predicted_completion_at) return [];
                  const expectedMinutes = Math.max(
                    0,
                    (Date.parse(rotation.predicted_completion_at) - forecastReferenceMs) / 60_000,
                  );
                  const intervalWidth = Math.max(
                    0,
                    (rotation.prediction_upper_minutes ?? 0) -
                      (rotation.prediction_lower_minutes ?? 0),
                  );
                  return [
                    {
                      lowerMinutes: Math.max(0, expectedMinutes - intervalWidth / 2),
                      expectedMinutes,
                      upperMinutes: expectedMinutes + intervalWidth / 2,
                    },
                  ];
                });
                const returnMinutes = aircraft.expected_review_at
                  ? Math.max(
                      0,
                      (Date.parse(aircraft.expected_review_at) - forecastReferenceMs) / 60_000,
                    )
                  : 0;
                return [
                  {
                    aircraft,
                    lowerMinutes: Math.max(
                      returnMinutes,
                      ...projectedCompletions.map((entry) => entry.lowerMinutes),
                    ),
                    expectedMinutes: Math.max(
                      returnMinutes,
                      ...projectedCompletions.map((entry) => entry.expectedMinutes),
                    ),
                    upperMinutes: Math.max(
                      returnMinutes,
                      ...projectedCompletions.map((entry) => entry.upperMinutes),
                    ),
                  },
                ];
              })
              .sort(
                (left, right) =>
                  left.expectedMinutes - right.expectedMinutes ||
                  left.aircraft.id.localeCompare(right.aircraft.id),
              )
              .slice(0, availablePilots.length)
              .flatMap((lane, index) => {
                const pilot = availablePilots[index];
                if (!pilot) return [];
                const applicablePlans = plannedOperationRows.results.filter(
                  (plan) =>
                    plan.status !== "CLEARED" &&
                    plan.status !== "CANCELED" &&
                    (plan.scope_type === "EVENT" ||
                      (plan.scope_type === "RESOURCE_GROUP" &&
                        plan.scope_id === product.resource_group_id) ||
                      (plan.scope_type === "AIRCRAFT" && plan.scope_id === lane.aircraft.id) ||
                      (plan.scope_type === "PILOT" && plan.scope_id === pilot.id)),
                );
                const unknownConstraintStart = applicablePlans.some(
                  (plan) =>
                    plan.start_mode === "AFTER_CURRENT_ROTATION" &&
                    !resourceGroupRotations.find(
                      (rotation) => rotation.id === plan.after_rotation_id,
                    )?.predicted_completion_at,
                );
                if (unknownConstraintStart) return [];
                const constraints = applicablePlans.map((plan) => {
                  const afterRotationCompletion = resourceGroupRotations.find(
                    (rotation) => rotation.id === plan.after_rotation_id,
                  )?.predicted_completion_at;
                  const earliestStart =
                    plan.start_mode === "AFTER_CURRENT_ROTATION"
                      ? Date.parse(afterRotationCompletion ?? forecastReadAt)
                      : Date.parse(plan.earliest_start_at ?? forecastReadAt);
                  const latestStart =
                    plan.start_mode === "AFTER_CURRENT_ROTATION"
                      ? earliestStart
                      : Date.parse(
                          plan.latest_start_at ?? plan.earliest_start_at ?? forecastReadAt,
                        );
                  const earliestStartMinutes = Math.max(
                    0,
                    (earliestStart - forecastReferenceMs) / 60_000,
                  );
                  const latestStartMinutes = Math.max(
                    earliestStartMinutes,
                    (latestStart - forecastReferenceMs) / 60_000,
                  );
                  return {
                    id: plan.id,
                    earliestStartMinutes,
                    expectedStartMinutes: (earliestStartMinutes + latestStartMinutes) / 2,
                    latestStartMinutes,
                    minimumDurationMinutes: plan.minimum_duration_minutes,
                    typicalDurationMinutes: plan.typical_duration_minutes,
                    maximumDurationMinutes: plan.maximum_duration_minutes,
                    effectMode: plan.effect_mode,
                    durationMultiplierPercent: plan.duration_multiplier_percent,
                    active: plan.status === "ACTIVE",
                  };
                });
                const recurringConstraints = recurringRuleRows.results
                  .filter(
                    (rule) =>
                      rule.status === "ACTIVE" &&
                      ((rule.scope_type === "AIRCRAFT" && rule.scope_id === lane.aircraft.id) ||
                        (rule.scope_type === "PILOT" && rule.scope_id === pilot.id)),
                  )
                  .map((rule) => ({
                    id: rule.id,
                    triggerMetric: rule.trigger_metric,
                    intervalValue: rule.interval_value,
                    lowerProgress: rule.progress_value,
                    expectedProgress: rule.progress_value,
                    upperProgress: rule.progress_value,
                    minimumDurationMinutes: rule.minimum_duration_minutes,
                    typicalDurationMinutes: rule.typical_duration_minutes,
                    maximumDurationMinutes: rule.maximum_duration_minutes,
                    active: true,
                  }));
                return [
                  {
                    laneId: `${lane.aircraft.id}:${pilot.id}`,
                    aircraftId: lane.aircraft.id,
                    passengerSeats: lane.aircraft.passenger_seats,
                    lowerMinutes: Math.max(lane.lowerMinutes, pilot.availableMinutes),
                    expectedMinutes: Math.max(lane.expectedMinutes, pilot.availableMinutes),
                    upperMinutes: Math.max(lane.upperMinutes, pilot.availableMinutes),
                    constraints,
                    recurringConstraints,
                  },
                ];
              });
      const availabilityAfterQueue = createQueueAvailability({
        activeAircraft: 0,
        busyAircraftMinutes: [],
        lanes: capacityLanes,
      });
      const durationByAircraftId = new Map(
        capacityLanes.map((lane) => {
          const override = aircraftProductTurnaroundOverrideRows.results.find(
            (entry) => entry.aircraft_id === lane.aircraftId && entry.product_id === product.id,
          );
          const aircraftProfile = resolveTurnaroundProfile({
            event: {
              sourceId: eventId,
              boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
              deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
              bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
            },
            product: {
              sourceId: product.id,
              boardingMinutes: product.planned_boarding_minutes_override,
              deboardingMinutes: product.planned_deboarding_minutes_override,
              bufferMinutes: product.planned_buffer_minutes_override,
            },
            ...(override
              ? {
                  aircraftProduct: {
                    sourceId: `${override.aircraft_id}:${override.product_id}`,
                    boardingMinutes: override.planned_boarding_minutes_override,
                    deboardingMinutes: override.planned_deboarding_minutes_override,
                    bufferMinutes: override.planned_buffer_minutes_override,
                  },
                }
              : {}),
          });
          return [
            lane.aircraftId,
            estimateDuration({
              referenceMinutes:
                product.reference_duration_minutes + aircraftProfile.totalGroundMinutes,
              actualDurationsMinutes: actualDurations,
              interrupted: false,
              activeCapacity: Math.max(1, capacityLanes.length),
            }),
          ] as const;
        }),
      );
      const queuedSeatsCompletedByEnd = resourceGroupRotations
        .filter(
          (rotation) =>
            rotation.status === "DRAFT" &&
            rotation.predicted_completion_at !== null &&
            Date.parse(rotation.predicted_completion_at) <= operationsEnd,
        )
        .reduce((sum, rotation) => sum + rotation.ticket_count, 0);
      const capacity = assessMarginalProductCapacity({
        operationsEndMinutes,
        availabilityAfterQueue,
        duration,
        durationByAircraftId,
        queuedSeatsCompletedByEnd,
        openTickets: product.resource_group_open_tickets,
        predictionQuality: forecast.quality,
        warningThreshold: product.capacity_warning_threshold,
        criticalThreshold: product.capacity_critical_threshold,
      });
      return {
        id: product.id,
        code: product.code,
        name: product.name,
        publicDescription: product.public_description,
        resourceGroupId: product.resource_group_id,
        resourceGroupName: product.resource_group_name,
        resourceGroupStatus: product.resource_group_status,
        resourceGroupOperationalNote: product.resource_group_operational_note,
        priceCents: product.price_cents,
        gateId: product.gate_id,
        gateLabel: product.gate_label,
        childCompanionRequired: product.child_companion_required === 1,
        weightClasses: JSON.parse(product.weight_classes_json) as Array<
          "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
        >,
        sortOrder: product.sort_order,
        saleEnabled: product.sale_enabled === 1,
        referenceCapacity: effectiveReferenceCapacity,
        referenceDurationMinutes: product.reference_duration_minutes,
        promisedFlightMinutes: product.promised_flight_minutes,
        plannedBoardingMinutesOverride: product.planned_boarding_minutes_override,
        plannedDeboardingMinutesOverride: product.planned_deboarding_minutes_override,
        plannedBufferMinutesOverride: product.planned_buffer_minutes_override,
        effectiveTurnaroundProfile,
        queuedTickets: product.queued_tickets,
        resourceGroupOpenTickets: product.resource_group_open_tickets,
        estimatedWaitLowerMinutes: forecast.lowerMinutes,
        estimatedWaitUpperMinutes: forecast.upperMinutes,
        nextBoardingWindowLowerAt,
        nextBoardingWindowUpperAt,
        remainingSellableSeats: capacity.remainingSellableSeats,
        projectedSeats: capacity.projectedSeats,
        capacityStatus: capacity.status,
        saleRecommended:
          capacity.saleRecommended &&
          eventRow.status === "ACTIVE" &&
          product.sale_enabled === 1 &&
          product.resource_group_status === "ACTIVE" &&
          eventRow.emergency_mode === 0 &&
          eventRow.operational_interrupted !== 1 &&
          (product.sale_closes_at === null || Date.parse(product.sale_closes_at) > Date.now()) &&
          (!eventRow.sale_opens_at || Date.parse(eventRow.sale_opens_at) <= Date.now()),
        saleClosesAt: product.sale_closes_at,
        capacityWarningThreshold: product.capacity_warning_threshold,
        capacityCriticalThreshold: product.capacity_critical_threshold,
        predictionQuality: forecast.quality,
      };
    }),
    aircraftProductTurnaroundOverrides: aircraftProductTurnaroundOverrideRows.results.flatMap(
      (override) => {
        const product = products.results.find((candidate) => candidate.id === override.product_id);
        if (!product) return [];
        return [
          {
            aircraftId: override.aircraft_id,
            productId: override.product_id,
            version: override.version,
            plannedBoardingMinutesOverride: override.planned_boarding_minutes_override,
            plannedDeboardingMinutesOverride: override.planned_deboarding_minutes_override,
            plannedBufferMinutesOverride: override.planned_buffer_minutes_override,
            effectiveTurnaroundProfile: resolveTurnaroundProfile({
              event: {
                sourceId: eventId,
                boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
                deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
                bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
              },
              product: {
                sourceId: product.id,
                boardingMinutes: product.planned_boarding_minutes_override,
                deboardingMinutes: product.planned_deboarding_minutes_override,
                bufferMinutes: product.planned_buffer_minutes_override,
              },
              aircraftProduct: {
                sourceId: `${override.aircraft_id}:${override.product_id}`,
                boardingMinutes: override.planned_boarding_minutes_override,
                deboardingMinutes: override.planned_deboarding_minutes_override,
                bufferMinutes: override.planned_buffer_minutes_override,
              },
            }),
          },
        ];
      },
    ),
    rotations: rotations.results.map((rotation, index) => {
      const activeAircraft = aircraftRows.results.filter(
        (aircraft) =>
          aircraft.resource_group_id === rotation.resource_group_id &&
          !["INACTIVE", "PAUSED", "REFUELING"].includes(aircraft.operational_state) &&
          aircraft.operational_interrupted === 0,
      ).length;
      const effectiveActiveCapacity = Math.min(activeAircraft, activePilotCount);
      const suggestedAircraft = fleetRows.results.find(
        (aircraft) => aircraft.id === rotation.suggested_aircraft_id,
      );
      const dispatchPlanFresh = rotation.dispatch_operation_day_version === eventRow.version;
      const dispatchAircraft = dispatchPlanFresh
        ? fleetRows.results.find(
            (aircraft) => aircraft.id === rotation.forecast_assumed_aircraft_id,
          )
        : undefined;
      const dispatchPilotId = rotation.dispatch_lane_id?.split(":")[1] ?? null;
      const dispatchPilot = dispatchPlanFresh
        ? pilotRows.results.find(
            (pilot) => pilot.id === dispatchPilotId && pilot.active === 1 && pilot.paused === 0,
          )
        : undefined;
      const rememberedPilot = pilotRows.results.find(
        (pilot) =>
          pilot.id === suggestedAircraft?.current_pilot_id &&
          pilot.active === 1 &&
          pilot.paused === 0 &&
          pilot.current_rotation_id === null,
      );
      const rotationProduct = products.results.find(
        (product) => product.code === rotation.product_code,
      );
      const profileAircraftId =
        rotation.aircraft_id ??
        (dispatchPlanFresh ? rotation.forecast_assumed_aircraft_id : null) ??
        null;
      const aircraftProductOverride = profileAircraftId
        ? aircraftProductTurnaroundOverrideRows.results.find(
            (override) =>
              override.product_id === rotationProduct?.id &&
              override.aircraft_id === profileAircraftId,
          )
        : undefined;
      const resolvedTurnaroundProfile = resolveTurnaroundProfile({
        event: {
          sourceId: eventId,
          boardingMinutes: eventRow.planned_boarding_minutes ?? 8,
          deboardingMinutes: eventRow.planned_deboarding_minutes ?? 5,
          bufferMinutes: eventRow.planned_buffer_minutes ?? 3,
        },
        ...(rotationProduct
          ? {
              product: {
                sourceId: rotationProduct.id,
                boardingMinutes: rotationProduct.planned_boarding_minutes_override,
                deboardingMinutes: rotationProduct.planned_deboarding_minutes_override,
                bufferMinutes: rotationProduct.planned_buffer_minutes_override,
              },
            }
          : {}),
        ...(aircraftProductOverride && rotationProduct
          ? {
              aircraftProduct: {
                sourceId: `${aircraftProductOverride.aircraft_id}:${rotationProduct.id}`,
                boardingMinutes: aircraftProductOverride.planned_boarding_minutes_override,
                deboardingMinutes: aircraftProductOverride.planned_deboarding_minutes_override,
                bufferMinutes: aircraftProductOverride.planned_buffer_minutes_override,
              },
            }
          : {}),
      });
      const frozenSource = (
        source: string | null,
        fallback: (typeof resolvedTurnaroundProfile)["boarding"],
      ) => {
        const separator = source?.indexOf(":") ?? -1;
        const sourceLevel = source?.slice(0, separator);
        return separator > 0 && ["AIRCRAFT_PRODUCT", "PRODUCT", "EVENT"].includes(sourceLevel ?? "")
          ? {
              sourceLevel: sourceLevel as "AIRCRAFT_PRODUCT" | "PRODUCT" | "EVENT",
              sourceId: source?.slice(separator + 1) ?? fallback.sourceId,
            }
          : { sourceLevel: fallback.sourceLevel, sourceId: fallback.sourceId };
      };
      const effectiveTurnaroundProfile =
        rotation.turnaround_boarding_minutes !== null &&
        rotation.turnaround_deboarding_minutes !== null &&
        rotation.turnaround_buffer_minutes !== null
          ? {
              boarding: {
                valueMinutes: rotation.turnaround_boarding_minutes,
                ...frozenSource(
                  rotation.turnaround_boarding_source,
                  resolvedTurnaroundProfile.boarding,
                ),
              },
              deboarding: {
                valueMinutes: rotation.turnaround_deboarding_minutes,
                ...frozenSource(
                  rotation.turnaround_deboarding_source,
                  resolvedTurnaroundProfile.deboarding,
                ),
              },
              buffer: {
                valueMinutes: rotation.turnaround_buffer_minutes,
                ...frozenSource(
                  rotation.turnaround_buffer_source,
                  resolvedTurnaroundProfile.buffer,
                ),
              },
              totalGroundMinutes:
                rotation.turnaround_boarding_minutes +
                rotation.turnaround_deboarding_minutes +
                rotation.turnaround_buffer_minutes,
            }
          : resolvedTurnaroundProfile;
      const forecastFreshness = assessForecastFreshness({
        predictionQuality: rotation.prediction_quality,
        predictionUpdatedAt: rotation.prediction_updated_at,
        now: forecastReadAt,
      });
      const forecastUnavailable =
        rotation.precall_decision_reason === "NO_FORECAST_CAPACITY" ||
        rotation.precall_decision_reason === "NO_FITTING_AIRCRAFT";
      const effectivePredictionQuality =
        eventRow.emergency_mode === 1 || forecastUnavailable
          ? "UNCERTAIN"
          : forecastFreshness.quality;
      const fallbackWindow = forecastQueueWindows({
        queueSequence: index + 1,
        activeAircraft: effectiveActiveCapacity,
        duration: estimateDuration({
          referenceMinutes:
            rotation.reference_duration_minutes + effectiveTurnaroundProfile.totalGroundMinutes,
          actualDurationsMinutes: actualDurations,
          interrupted: eventRow.emergency_mode === 1 || eventRow.operational_interrupted === 1,
          activeCapacity: effectiveActiveCapacity,
        }),
      });
      const predictedLowerMinutes = forecastUnavailable
        ? null
        : (rotation.prediction_lower_minutes ?? fallbackWindow.lowerMinutes);
      const predictedUpperMinutes = forecastUnavailable
        ? null
        : (rotation.prediction_upper_minutes ?? fallbackWindow.upperMinutes);
      const boardingWindow = predictedBoardingWindow({
        status: rotation.status,
        quality: effectivePredictionQuality,
        predictedBoardingAt: rotation.predicted_boarding_at,
        lowerMinutes: predictedLowerMinutes ?? 0,
        upperMinutes: predictedUpperMinutes ?? 0,
        referenceAt: forecastReadAt,
      });
      const predictedCompletionMs = rotation.predicted_completion_at
        ? Date.parse(rotation.predicted_completion_at)
        : Number.NaN;
      const operationsEndMs = eventRow.operations_end_at
        ? Date.parse(eventRow.operations_end_at)
        : Number.NaN;
      const overtimeMinutes =
        Number.isFinite(predictedCompletionMs) && Number.isFinite(operationsEndMs)
          ? Math.max(0, Math.ceil((predictedCompletionMs - operationsEndMs) / 60_000))
          : 0;
      return {
        id: rotation.id,
        version: rotation.version,
        flightGroupId: rotation.flight_group_id,
        communicationNumber: rotation.communication_number,
        communicationLabel: formatFlightGroupLabel(
          rotation.resource_group_short_code,
          rotation.communication_number,
        ),
        queuePosition: rotation.queue_position,
        productCode: rotation.product_code,
        productName: rotation.product_name,
        status: rotation.status,
        bookingGroups: JSON.parse(rotation.booking_groups_json),
        ticketGroupId: rotation.ticket_group_id,
        gateId: rotation.gate_id,
        gateLabel: rotation.gate_label,
        aircraftId: rotation.aircraft_id,
        aircraftRegistration: rotation.aircraft_registration,
        pilotId: rotation.pilot_id,
        pilotOperationalCode: rotation.pilot_operational_code,
        suggestedPilotId: dispatchPilot?.id ?? rememberedPilot?.id ?? rotation.suggested_pilot_id,
        suggestedPilotOperationalCode:
          dispatchPilot?.operational_code ??
          rememberedPilot?.operational_code ??
          rotation.suggested_pilot_operational_code,
        suggestedAircraftId:
          (dispatchPlanFresh ? rotation.forecast_assumed_aircraft_id : null) ??
          rotation.suggested_aircraft_id,
        suggestedAircraftRegistration:
          dispatchAircraft?.registration ?? rotation.suggested_aircraft_registration,
        ticketCount: rotation.ticket_count,
        baselineCapacity: rotation.baseline_capacity,
        usableCapacity: rotation.usable_capacity ?? rotation.baseline_capacity,
        capacityReduced:
          rotation.usable_capacity !== null &&
          rotation.usable_capacity < rotation.baseline_capacity,
        estimatedPassengerPayloadKg: rotation.estimated_passenger_payload_kg,
        predictedLowerMinutes,
        predictedUpperMinutes,
        boardingWindowLowerAt: boardingWindow.lowerAt,
        boardingWindowUpperAt: boardingWindow.upperAt,
        precalledAt: rotation.precalled_at,
        precallDecision:
          rotation.precall_decision_status &&
          rotation.precall_decision_reason &&
          rotation.precall_decision_at
            ? {
                status: rotation.precall_decision_status,
                reason: rotation.precall_dispatch_reason ?? rotation.precall_decision_reason,
                decidedAt: rotation.precall_decision_at,
                predictedBoardingAt: rotation.precall_predicted_boarding_at,
                adaptiveLeadMinutes: rotation.precall_adaptive_lead_minutes,
                gateId: rotation.precall_gate_id,
                adaptiveBaseLeadMinutes: rotation.precall_adaptive_base_lead_minutes,
                gateTravelLeadMinutes: rotation.precall_gate_travel_lead_minutes,
                effectiveLeadMinutes: rotation.precall_effective_lead_minutes,
                boardingWindowLowerAt: rotation.precall_boarding_window_lower_at,
                boardingWindowUpperAt: rotation.precall_boarding_window_upper_at,
              }
            : null,
        calledAt: rotation.called_at,
        dispatchPlan:
          dispatchPlanFresh && rotation.dispatch_plan_id && rotation.dispatch_plan_revision
            ? {
                planId: rotation.dispatch_plan_id,
                revision: rotation.dispatch_plan_revision,
                batchId: rotation.dispatch_batch_id,
                dispatchOrder: rotation.dispatch_order,
                wave: rotation.dispatch_wave,
                laneId: rotation.dispatch_lane_id,
                groupIds: JSON.parse(rotation.dispatch_group_ids_json) as string[],
                occupiedSeats: rotation.dispatch_occupied_seats,
                availableSeats: rotation.dispatch_available_seats,
                commitmentLevel: rotation.dispatch_commitment_level,
                decisionReasons: JSON.parse(rotation.dispatch_decision_reasons_json) as string[],
                confirmedOvertakeCount: rotation.dispatch_confirmed_overtake_count,
                projectedOvertakeCount: rotation.dispatch_projected_overtake_count,
                unplannedReason: rotation.dispatch_unplanned_reason,
              }
            : null,
        deferralCount: rotation.deferral_count,
        operationalNote: rotation.operational_note,
        timeline: {
          planned: {
            boardingAt: rotation.planned_boarding_at,
            departureAt: rotation.planned_departure_at,
            landingAt: rotation.planned_landing_at,
            completionAt: rotation.planned_completion_at,
          },
          predicted: {
            boardingAt: rotation.predicted_boarding_at,
            departureAt: rotation.predicted_departure_at,
            landingAt: rotation.predicted_landing_at,
            completionAt: rotation.predicted_completion_at,
          },
          actual: {
            boardingAt: rotation.called_at,
            departureAt: rotation.departed_at,
            landingAt: rotation.landed_at,
            completionAt: rotation.completed_at,
          },
          predictionQuality: effectivePredictionQuality,
          predictionUpdatedAt: rotation.prediction_updated_at,
          forecastAssumedAircraftId: rotation.forecast_assumed_aircraft_id,
          extendsBeyondOperationsEnd: overtimeMinutes > 0,
          overtimeMinutes,
          effectiveTurnaroundProfile,
        },
        tickets: JSON.parse(rotation.tickets_json) as Array<{
          id: string;
          status:
            | "QUEUED"
            | "CHECKED_IN"
            | "CALLED"
            | "BOARDING"
            | "IN_FLIGHT"
            | "LANDED"
            | "COMPLETED"
            | "NO_SHOW"
            | "CANCELED"
            | "CLARIFICATION";
          attendanceStatus: "NOT_CHECKED_IN" | "CHECKED_IN";
        }>,
      };
    }),
    queueGroups: queueGroupRows.results.map((group) => ({
      id: group.id,
      communicationNumber: group.communication_number,
      productId: group.product_id,
      productCode: group.product_code,
      productName: group.product_name,
      resourceGroupId: group.resource_group_id,
      gateId: group.gate_id,
      queueSequence: group.queue_sequence,
      status: group.status,
      ticketCount: group.ticket_count,
      presentCount: group.present_count,
      nextSegmentTicketCount: group.next_segment_ticket_count,
      nextSegmentPresentCount: group.next_segment_present_count,
      segmentIndex: group.segment_index,
      segmentCount: group.segment_count,
      precalledAt: group.precalled_at,
      dispatchReservation: dispatchReservationByGroupId.get(group.id) ?? null,
      recalledAt: group.recall_started_at,
      recallCount: group.recall_count,
      activeRecall: activeTicketGroupRecallProjection(group),
    })),
    aircraft: fleetRows.results.map((aircraft) => ({
      id: aircraft.id,
      version: aircraft.version,
      registration: aircraft.registration,
      aircraftType: aircraft.aircraft_type,
      passengerSeats: aircraft.passenger_seats,
      maximumPassengerPayloadKg: aircraft.maximum_passenger_payload_kg,
      operationalState:
        aircraft.operational_interrupted === 1 ? "INTERRUPTED" : aircraft.operational_state,
      operationalStateChangedAt: aircraft.operational_state_changed_at,
      resourceGroupId: aircraft.resource_group_id ?? "",
      resourceGroupName: aircraft.resource_group_name ?? "Nicht zugeordnet",
      resourceGroupShortCode: aircraft.resource_group_short_code ?? "–",
      refuelPlanned: aircraft.refuel_planned === 1,
      rotationsSinceRefuel: aircraft.rotations_since_refuel,
      refuelReminderThreshold: aircraft.refuel_reminder_threshold,
      expectedReviewAt: aircraft.expected_review_at,
      currentPilotId: aircraft.current_pilot_id,
      currentPilotOperationalCode: aircraft.current_pilot_operational_code,
    })),
    assistClaims: assistClaims.map((claim) => ({
      aircraftId: claim.aircraft_id,
      claimedByCurrentOperator:
        device.accountId !== null && claim.operator_account_id === device.accountId,
      ownerLoginCode: claim.login_code,
      revision: claim.revision,
      claimedAt: claim.claimed_at,
      expiresAt: claim.expires_at,
    })),
    pilots: pilotRows.results.map((pilot) => ({
      id: pilot.id,
      operationalCode: pilot.operational_code,
      operationalNote: pilot.operational_note,
      active: pilot.active === 1,
      paused: pilot.paused === 1,
      pauseExpectedReviewAt: pilot.pause_expected_review_at,
      currentRotationId: pilot.current_rotation_id,
      currentCommunicationNumber: pilot.current_communication_number,
    })),
    plannedOperations: plannedOperationRows.results.map((plan) => ({
      id: plan.id,
      version: plan.version,
      scopeType: plan.scope_type,
      scopeId: plan.scope_id,
      kind: plan.constraint_kind,
      effectMode: plan.effect_mode,
      durationMultiplierPercent: plan.duration_multiplier_percent,
      startMode: plan.start_mode,
      earliestStartAt: plan.earliest_start_at,
      latestStartAt: plan.latest_start_at,
      afterRotationId: plan.after_rotation_id,
      minimumDurationMinutes: plan.minimum_duration_minutes,
      typicalDurationMinutes: plan.typical_duration_minutes,
      maximumDurationMinutes: plan.maximum_duration_minutes,
      status:
        plan.status === "PLANNED" &&
        ((plan.latest_start_at !== null && Date.parse(plan.latest_start_at) <= Date.now()) ||
          (plan.start_mode === "AFTER_CURRENT_ROTATION" &&
            ["COMPLETED", "CANCELED"].includes(plan.after_rotation_status ?? "")))
          ? "DUE"
          : plan.status,
      publicNote: plan.public_note,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
      activatedAt: plan.activated_at,
      clearedAt: plan.cleared_at,
      canceledAt: plan.canceled_at,
      recurringRuleId: plan.recurring_rule_id,
      recurrenceSequence: plan.recurrence_sequence,
    })),
    recurringOperationalRules: recurringRuleRows.results.map((rule) => ({
      id: rule.id,
      operationDayId: rule.operation_day_id,
      version: rule.version,
      scopeType: rule.scope_type,
      scopeId: rule.scope_id,
      kind: rule.operation_kind,
      triggerMetric: rule.trigger_metric,
      intervalValue: rule.interval_value,
      progressValue: rule.progress_value,
      minimumDurationMinutes: rule.minimum_duration_minutes,
      typicalDurationMinutes: rule.typical_duration_minutes,
      maximumDurationMinutes: rule.maximum_duration_minutes,
      status: rule.status,
      sequenceNumber: rule.sequence_number,
      openPlannedOperationId: rule.open_plan_id,
      reason: rule.reason,
      lastResetAt: rule.last_reset_at,
      createdAt: rule.created_at,
      updatedAt: rule.updated_at,
    })),
    gates: gatesRows.results.map((gate) => ({
      id: gate.id,
      label: gate.label,
      gateType: gate.gate_type,
      active: gate.active === 1,
      sortOrder: gate.sort_order,
      travelLeadMinutes: gate.travel_lead_minutes,
      displayFilter: gateDisplayFilterSchema.parse(JSON.parse(gate.display_filter_json)),
      assignedResourceGroupIds: JSON.parse(gate.assigned_resource_group_ids_json) as string[],
    })),
    resourceGroups: resourceGroupRows.results.map((group) => {
      const activeAircraftIds = JSON.parse(group.aircraft_ids_json) as string[];
      const effectiveReferenceCapacity = Math.max(
        1,
        deriveResourceGroupCapacity(
          fleetRows.results
            .filter((aircraft) => activeAircraftIds.includes(aircraft.id))
            .map((aircraft) => aircraft.passenger_seats),
        ),
      );
      return {
        id: group.id,
        version: group.version,
        name: group.name,
        shortCode: group.short_code,
        status: group.status,
        operationalNote: group.operational_note,
        gateId: group.gate_id,
        gateLabel: group.gate_label,
        referenceCapacity: effectiveReferenceCapacity,
        compatibleAircraftTypes: [],
        automaticPrecallEnabled: group.automatic_precall_enabled === 1,
        activeAircraftIds,
      };
    }),
    metrics: {
      openTickets: metricsRow?.open_tickets ?? 0,
      soldTickets: metricsRow?.sold_tickets ?? 0,
      completedRotations: metricsRow?.completed_rotations ?? 0,
      activeRotations: metricsRow?.active_rotations ?? 0,
      averageBoardingMinutes: metricsRow?.average_boarding_minutes ?? null,
      averageFlightMinutes: metricsRow?.average_flight_minutes ?? null,
      averageTurnaroundMinutes: metricsRow?.average_turnaround_minutes ?? null,
      averageRotationMinutes: metricsRow?.average_rotation_minutes ?? null,
      averageWaitMinutes: metricsRow?.average_wait_minutes ?? null,
      informationalRevenueCents: metricsRow?.informational_revenue_cents ?? 0,
      activeDevices: metricsRow?.active_devices ?? 0,
      activePushSubscriptions: metricsRow?.active_push_subscriptions ?? 0,
    },
  });
  response.headers.set(
    "server-timing",
    `operations;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
  );
  return response;
});

app.on("POST", eventRoutes("/analysis/snapshot.json"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = context.get("sessionActor");
  const device = await authorizeDevice(context.env, eventId, context.req.raw, actor);
  if (
    !actor ||
    !device ||
    !["ADMIN", "FLIGHT_DIRECTOR"].includes(actor.role) ||
    !["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)
  ) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Für die Diagnose ist eine berechtigte Sitzung erforderlich.",
        },
      },
      403,
    );
  }
  const request = analysisSnapshotRequestSchema.safeParse(
    await context.req.json().catch(() => null),
  );
  if (!request.success) {
    return context.json(
      {
        error: {
          code: "ANALYSIS_SNAPSHOT_INVALID_REQUEST",
          message: "Die Diagnoseanforderung ist ungültig.",
        },
      },
      400,
    );
  }
  const { requestId, expectedEventVersion } = request.data;
  const readVersion = async (): Promise<number | null> => {
    const row = await context.env.DB.prepare("SELECT version FROM operation_days WHERE id = ?1")
      .bind(eventId)
      .first<{ version: number }>();
    return row?.version ?? null;
  };
  const initialVersion = await readVersion();
  if (initialVersion === null) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  if (initialVersion !== expectedEventVersion) {
    return context.json(
      {
        error: {
          code: "ANALYSIS_SNAPSHOT_STALE_VERSION",
          message: "Die Betriebsdaten wurden inzwischen aktualisiert.",
          currentVersion: initialVersion,
        },
      },
      412,
    );
  }

  const capture = await eventCoordinatorNamespace(context.env)
    .getByName(eventId)
    .captureAnalysisSnapshot({
      eventId,
      requestId,
      expectedEventVersion,
      deviceId: device.id,
      actorRole: actor.role,
      deviceRole: device.role,
    });
  if (!capture.ok) {
    const status =
      capture.code === "SESSION_NOT_AUTHORIZED"
        ? 403
        : capture.code === "ANALYSIS_SNAPSHOT_STALE_VERSION"
          ? 412
          : capture.code === "ANALYSIS_SNAPSHOT_CAPTURE_FAILED"
            ? 500
            : 409;
    return context.json(
      {
        error: {
          code: capture.code,
          message:
            capture.code === "SESSION_NOT_AUTHORIZED"
              ? "Für die Diagnose ist eine berechtigte Sitzung erforderlich."
              : capture.code === "ANALYSIS_SNAPSHOT_STALE_VERSION"
                ? "Die Betriebsdaten wurden inzwischen aktualisiert."
                : capture.code === "ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT"
                  ? "Die Diagnoseanforderung wurde bereits mit anderen Daten verwendet."
                  : "Der aktuelle Planungslauf konnte nicht erstellt werden.",
          currentVersion: capture.currentVersion,
        },
      },
      status,
    );
  }

  {
    const beforeVersion = await readVersion();
    if (beforeVersion !== expectedEventVersion) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_SNAPSHOT_CHANGED",
            message: "Die Betriebsdaten haben sich während des Exports geändert.",
            currentVersion: beforeVersion ?? undefined,
          },
        },
        409,
      );
    }
    const operationsUrl = new URL(context.req.url);
    operationsUrl.pathname = `/api/control/${encodeURIComponent(eventId)}/operations`;
    operationsUrl.search = "";
    const operationsResponse = await app.request(
      new Request(operationsUrl, { headers: context.req.raw.headers }),
      undefined,
      context.env,
      context.executionCtx,
    );
    if (!operationsResponse.ok) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE",
            message: "Der sichere Betriebszustand konnte nicht aufgebaut werden.",
          },
        },
        409,
      );
    }
    const operationBoard = operationBoardSchema.safeParse(await operationsResponse.json());
    if (!operationBoard.success || operationBoard.data.event.version !== expectedEventVersion) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_SNAPSHOT_CHANGED",
            message: "Die Betriebsdaten haben sich während des Exports geändert.",
            currentVersion: operationBoard.success
              ? operationBoard.data.event.version
              : expectedEventVersion,
          },
        },
        409,
      );
    }
    let snapshot: AnalysisSnapshot;
    try {
      snapshot = await buildAnalysisSnapshot({
        env: context.env,
        eventId,
        expectedEventVersion,
        planningRunId: capture.planningRunId,
        operationBoard: operationBoard.data as OperationBoard,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE";
      const safeCode = [
        "ANALYSIS_SNAPSHOT_NOT_READY",
        "ANALYSIS_SNAPSHOT_CHANGED",
        "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE",
      ].includes(code)
        ? code
        : "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE";
      return context.json(
        {
          error: {
            code: safeCode,
            message:
              safeCode === "ANALYSIS_SNAPSHOT_NOT_READY"
                ? "Der aktuelle Planungslauf ist noch nicht verfügbar."
                : "Die Diagnose konnte nicht konsistent aufgebaut werden.",
            currentVersion: (await readVersion()) ?? undefined,
          },
        },
        409,
      );
    }
    const afterVersion = await readVersion();
    if (afterVersion !== expectedEventVersion) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_SNAPSHOT_CHANGED",
            message: "Die Betriebsdaten haben sich während des Exports geändert.",
            currentVersion: afterVersion ?? undefined,
          },
        },
        409,
      );
    }
    const validated = analysisSnapshotSchema.parse(snapshot);
    const localTime = validated.manifest.capturedAt.slice(11, 19).replaceAll(":", "-");
    const filename = `rundflug-analyse-momentaufnahme-${validated.manifest.eventDate}-${localTime}.json`;
    return context.body(JSON.stringify(validated), 200, {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
  }
});

app.on("GET", eventRoutes("/analysis/day-archives"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = context.get("sessionActor");
  const device = await authorizeDevice(context.env, eventId, context.req.raw, actor);
  if (!actor || !device || actor.role !== "ADMIN" || device.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  return context.json(
    analysisArchiveListSchema.parse({ archives: await listAnalysisArchives(context.env, eventId) }),
  );
});

app.on("POST", eventRoutes("/analysis/day-archives"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = context.get("sessionActor");
  const device = await authorizeDevice(context.env, eventId, context.req.raw, actor);
  if (!actor || !device || actor.role !== "ADMIN" || device.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const parsed = analysisArchiveRequestSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json(
      {
        error: { code: "ANALYSIS_ARCHIVE_REQUEST_INVALID", message: "Archivauftrag ist ungültig." },
      },
      400,
    );
  }
  try {
    const result = await requestAnalysisArchive({
      env: context.env,
      eventId,
      expectedEventVersion: parsed.data.expectedEventVersion,
      requestId: parsed.data.requestId,
      actorAlias: await analysisActorAlias(actor.accountId),
    });
    if (result.created) {
      context.executionCtx.waitUntil(buildAnalysisArchive(context.env, result.archive.id));
    }
    return context.json(analysisArchiveSchema.parse(result.archive), result.created ? 202 : 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : "ANALYSIS_ARCHIVE_REQUEST_FAILED";
    if (code === "EVENT_NOT_FOUND") {
      return context.json({ error: { code, message: "Veranstaltung nicht gefunden." } }, 404);
    }
    if (code === "ANALYSIS_ARCHIVE_IDEMPOTENCY_CONFLICT") {
      return context.json(
        { error: { code, message: "Die Auftrags-ID wurde bereits anders verwendet." } },
        409,
      );
    }
    if (code === "ANALYSIS_ARCHIVE_STALE_VERSION" || code === "ANALYSIS_ARCHIVE_EVENT_OPEN") {
      return context.json(
        {
          error: {
            code,
            message:
              code === "ANALYSIS_ARCHIVE_EVENT_OPEN"
                ? "Das Tagesarchiv kann erst nach dem Schließen erstellt werden."
                : "Die Veranstaltungsversion wurde inzwischen geändert.",
          },
        },
        409,
      );
    }
    throw error;
  }
});

app.on("POST", eventRoutes("/analysis/day-archives/:archiveId/download"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = context.get("sessionActor");
  const device = await authorizeDevice(context.env, eventId, context.req.raw, actor);
  if (!actor || !device || actor.role !== "ADMIN" || device.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const download = await analysisArchiveDownload({
    env: context.env,
    eventId,
    archiveId: context.req.param("archiveId"),
    actorAlias: await analysisActorAlias(actor.accountId),
  });
  if (!download) {
    return context.json(
      { error: { code: "ANALYSIS_ARCHIVE_NOT_READY", message: "Archiv ist nicht verfügbar." } },
      404,
    );
  }
  return new Response(download.object.body, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="rundflug-tagesanalyse-${eventId}-v${download.archive.eventVersion}.zip"`,
      "content-length": String(download.object.size),
      "content-type": "application/zip",
      "x-content-type-options": "nosniff",
    },
  });
});

app.on("DELETE", eventRoutes("/analysis/day-archives/:archiveId"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = context.get("sessionActor");
  const device = await authorizeDevice(context.env, eventId, context.req.raw, actor);
  if (!actor || !device || actor.role !== "ADMIN" || device.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  try {
    const archive = await deleteAnalysisArchive({
      env: context.env,
      eventId,
      archiveId: context.req.param("archiveId"),
      actorAlias: await analysisActorAlias(actor.accountId),
    });
    if (!archive) {
      return context.json(
        { error: { code: "ANALYSIS_ARCHIVE_NOT_FOUND", message: "Archiv nicht gefunden." } },
        404,
      );
    }
    return context.json(analysisArchiveSchema.parse(archive));
  } catch (error) {
    if (error instanceof Error && error.message === "ANALYSIS_ARCHIVE_BUILDING") {
      return context.json(
        { error: { code: error.message, message: "Archiv wird gerade erstellt." } },
        409,
      );
    }
    throw error;
  }
});

app.on("GET", eventRoutes("/tickets/search"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["CASHIER", "FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const searchParams = new URL(context.req.url).searchParams;
  const parsedRequest = ticketSearchRequestSchema.safeParse({
    q: searchParams.get("q") ?? "",
    status: searchParams.get("status") ?? "ACTIVE",
    limit: searchParams.has("limit") ? Number(searchParams.get("limit")) : 20,
    ...(searchParams.has("cursor") ? { cursor: searchParams.get("cursor") ?? "" } : {}),
    ticketGroupIds: searchParams.getAll("id"),
    ...(searchParams.has("soldByAccountId")
      ? { soldByOperatorAccountId: searchParams.get("soldByAccountId") ?? "" }
      : {}),
  });
  if (!parsedRequest.success) {
    return context.json(
      { error: { code: "INVALID_TICKET_SEARCH", message: "Ticketsuche ist ungültig." } },
      400,
    );
  }
  const request = parsedRequest.data;
  const rawQuery = request.q;
  if (rawQuery.length === 1 || rawQuery.length > 200) {
    return context.json({ results: [], nextCursor: null });
  }
  const cursor = decodeTicketSearchCursor(request.cursor);
  if (request.cursor && !cursor) {
    return context.json(
      { error: { code: "INVALID_TICKET_SEARCH_CURSOR", message: "Listencursor ist ungültig." } },
      400,
    );
  }
  let query = rawQuery;
  try {
    const url = new URL(rawQuery);
    query = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? rawQuery);
  } catch {
    // Plain ticket, group or communication identifier.
  }
  const normalized = query.trim().toUpperCase();
  const ticketHash = await sha256Hex(normalized);
  const likeQuery = `%${query.trim()}%`;
  const numericText = normalized.replace(/^[GF]-?/, "");
  const numericQuery = /^\d+$/.test(numericText) ? String(Number(numericText)) : "";
  const conditions = ["tg.operation_day_id = ?1"];
  const bindings: Array<string | number> = [eventId];
  const bind = (value: string | number) => {
    bindings.push(value);
    return `?${bindings.length}`;
  };
  if (request.ticketGroupIds.length > 0) {
    const placeholders = request.ticketGroupIds.map((id) => bind(id));
    conditions.push(`tg.id IN (${placeholders.join(", ")})`);
  } else {
    conditions.push(ticketSearchStatusCondition(request.status));
  }
  if (request.soldByOperatorAccountId) {
    conditions.push(`tg.sold_by_operator_account_id = ${bind(request.soldByOperatorAccountId)}`);
  }
  if (normalized) {
    const ticketHashPlaceholder = bind(ticketHash);
    const likePlaceholder = bind(likeQuery);
    const numericPlaceholder = bind(numericQuery);
    const normalizedPlaceholder = bind(normalized);
    conditions.push(
      `(EXISTS (SELECT 1 FROM tickets searched_ticket
                  WHERE searched_ticket.ticket_group_id = tg.id
                    AND searched_ticket.public_code_hash = ${ticketHashPlaceholder})
        OR tg.public_status_code_hash = ${ticketHashPlaceholder}
        OR tg.id LIKE ${likePlaceholder}
        OR CAST(tg.communication_number AS TEXT) = ${numericPlaceholder}
        OR UPPER('G-' || p.code || '-' || printf('%04d', tg.communication_number))
             = ${normalizedPlaceholder}
        OR UPPER('G-' || printf('%04d', tg.communication_number)) = ${normalizedPlaceholder}
        OR UPPER(p.code || '-' || printf('%03d', tg.communication_number))
             = ${normalizedPlaceholder}
        OR EXISTS (SELECT 1 FROM tickets searched_ticket
                    JOIN rotation_tickets searched_rt ON searched_rt.ticket_id = searched_ticket.id
                    JOIN rotations searched_rotation ON searched_rotation.id = searched_rt.rotation_id
                    JOIN flight_groups searched_fg ON searched_fg.id = searched_rotation.flight_group_id
                    JOIN resource_groups searched_rg ON searched_rg.id = searched_fg.resource_group_id
                   WHERE searched_ticket.ticket_group_id = tg.id
                     AND (CAST(searched_fg.communication_number AS TEXT) = ${numericPlaceholder}
                       OR UPPER('F-' || searched_rg.short_code || '-' ||
                                printf('%03d', searched_fg.communication_number))
                            = ${normalizedPlaceholder}
                       OR UPPER(p.code || '-' || printf('%03d', searched_fg.communication_number)) = ${normalizedPlaceholder})))`,
    );
  }
  if (cursor) {
    const soldAtPlaceholder = bind(cursor.soldAt);
    const idPlaceholder = bind(cursor.id);
    conditions.push(
      `(tg.sold_at < ${soldAtPlaceholder} OR (tg.sold_at = ${soldAtPlaceholder} AND tg.id < ${idPlaceholder}))`,
    );
  }
  const effectiveLimit =
    request.ticketGroupIds.length > 0 ? Math.min(request.ticketGroupIds.length, 50) : request.limit;
  const limitPlaceholder = bind(effectiveLimit + 1);
  const rows = await context.env.DB.prepare(
    `SELECT tg.id AS ticket_group_id, tg.status AS group_status,
            tg.queue_sequence, tg.communication_number AS booking_group_number, tg.standby,
            tg.sold_at, p.id AS product_id, p.code AS product_code, p.name AS product_name,
            tg.sold_by_operator_account_id, seller.login_code AS sold_by_operator_login_code,
            rg.short_code AS resource_group_short_code,
            (SELECT COUNT(*) FROM tickets group_ticket WHERE group_ticket.ticket_group_id = tg.id)
              AS group_size,
            (SELECT GROUP_CONCAT(DISTINCT group_fg.communication_number)
               FROM tickets grouped_ticket
               JOIN rotation_tickets group_rt
                 ON group_rt.ticket_id = grouped_ticket.id AND group_rt.released_at IS NULL
               JOIN rotations group_rotation ON group_rotation.id = group_rt.rotation_id
               JOIN flight_groups group_fg ON group_fg.id = group_rotation.flight_group_id
              WHERE grouped_ticket.ticket_group_id = tg.id) AS communication_numbers,
            (SELECT GROUP_CONCAT(DISTINCT group_rotation.status)
               FROM tickets grouped_ticket
               JOIN rotation_tickets group_rt
                 ON group_rt.ticket_id = grouped_ticket.id AND group_rt.released_at IS NULL
               JOIN rotations group_rotation ON group_rotation.id = group_rt.rotation_id
              WHERE grouped_ticket.ticket_group_id = tg.id) AS rotation_statuses
       FROM ticket_groups tg
       JOIN products p ON p.id = tg.product_id
       JOIN resource_groups rg ON rg.id = p.resource_group_id
       LEFT JOIN operator_accounts seller ON seller.id = tg.sold_by_operator_account_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY tg.sold_at DESC, tg.id DESC LIMIT ${limitPlaceholder}`,
  )
    .bind(...bindings)
    .all<{
      ticket_group_id: string;
      group_status: string;
      queue_sequence: number;
      booking_group_number: number;
      standby: number;
      sold_at: string;
      sold_by_operator_account_id: string | null;
      sold_by_operator_login_code: string | null;
      product_id: string;
      product_code: string;
      product_name: string;
      resource_group_short_code: string;
      group_size: number;
      communication_numbers: string | null;
      rotation_statuses: string | null;
    }>();
  const page = rows.results.slice(0, effectiveLimit);
  const last = page.at(-1);
  return context.json({
    results: page.map((row) => {
      const communicationNumbers = (row.communication_numbers?.split(",") ?? [])
        .map(Number)
        .filter(Number.isInteger)
        .sort((left, right) => left - right);
      const communicationLabels = communicationNumbers.map((number) =>
        formatFlightGroupLabel(row.resource_group_short_code, number),
      );
      const rotationStatuses = (row.rotation_statuses?.split(",") ?? []).sort();
      return {
        ticketGroupId: row.ticket_group_id,
        productId: row.product_id,
        productCode: row.product_code,
        productName: row.product_name,
        groupStatus: row.group_status,
        groupSize: row.group_size,
        queueSequence: row.queue_sequence,
        bookingGroupNumber: row.booking_group_number,
        bookingGroupLabel: formatBookingGroupLabel(row.product_code, row.booking_group_number),
        standby: row.standby === 1,
        soldAt: row.sold_at,
        soldByOperatorAccountId: row.sold_by_operator_account_id,
        soldByOperatorLoginCode: row.sold_by_operator_login_code,
        communicationNumber: communicationNumbers[0] ?? null,
        communicationLabel: communicationLabels[0] ?? null,
        communicationNumbers,
        communicationLabels,
        rotationStatus: rotationStatuses[0] ?? null,
        rotationStatuses,
      };
    }),
    nextCursor:
      request.ticketGroupIds.length === 0 && rows.results.length > effectiveLimit && last
        ? encodeTicketSearchCursor({ soldAt: last.sold_at, id: last.ticket_group_id })
        : null,
  });
});

app.on("GET", eventRoutes("/ticket-groups/:ticketGroupId/print-data"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["CASHIER", "ADMIN"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const ticketGroupId = context.req.param("ticketGroupId");
  const first = await context.env.DB.prepare(
    `SELECT COALESCE(tg.public_status_code,
                     (SELECT legacy.public_code
                        FROM tickets legacy
                       WHERE legacy.ticket_group_id = tg.id AND legacy.public_code IS NOT NULL
                       ORDER BY legacy.created_at, legacy.id LIMIT 1)) AS public_code,
            od.name AS event_name, p.name AS product_name, g.label AS gate_label,
            p.code AS product_code, tg.communication_number, tg.status AS group_status,
            COUNT(t.id) AS group_size
       FROM ticket_groups tg
       JOIN operation_days od ON od.id = tg.operation_day_id
       JOIN products p ON p.id = tg.product_id
       JOIN gates g ON g.id = p.gate_id
       JOIN tickets t ON t.ticket_group_id = tg.id
      WHERE tg.id = ?1 AND tg.operation_day_id = ?2
      GROUP BY tg.id`,
  )
    .bind(ticketGroupId, eventId)
    .first<{
      public_code: string | null;
      event_name: string;
      product_name: string;
      gate_label: string;
      product_code: string;
      communication_number: number;
      group_status: string;
      group_size: number;
    }>();
  if (!first?.public_code) {
    return context.json(
      { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Buchungsgruppe nicht gefunden." } },
      404,
    );
  }
  if (first.group_status === "CANCELED") {
    return context.json(
      {
        error: {
          code: "TICKET_GROUP_CANCELED",
          message: "Stornierte Tickets werden nicht erneut ausgegeben.",
        },
      },
      409,
    );
  }
  return context.json({
    ticketGroupId,
    eventName: first.event_name,
    productName: first.product_name,
    gateLabel: first.gate_label,
    communicationLabel: formatBookingGroupLabel(first.product_code, first.communication_number),
    code: first.public_code,
    groupSize: first.group_size,
  });
});

app.on("GET", eventRoutes("/history"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const conditions = ["operation_day_id = ?1"];
  const bindings: Array<string | number> = [eventId];
  const addFilter = (column: string, value: string | undefined) => {
    if (!value?.trim()) return;
    bindings.push(value.trim());
    conditions.push(`${column} = ?${bindings.length}`);
  };
  addFilter("event_type", context.req.query("eventType"));
  addFilter("aggregate_type", context.req.query("aggregateType"));
  addFilter("aggregate_id", context.req.query("aggregateId"));
  addFilter("device_id", context.req.query("deviceId"));
  const since = context.req.query("since");
  if (since && !Number.isNaN(Date.parse(since))) {
    bindings.push(new Date(since).toISOString());
    conditions.push(`occurred_at >= ?${bindings.length}`);
  }
  const until = context.req.query("until");
  if (until && !Number.isNaN(Date.parse(until))) {
    bindings.push(new Date(until).toISOString());
    conditions.push(`occurred_at <= ?${bindings.length}`);
  }
  const requestedLimit = Number.parseInt(context.req.query("limit") ?? "200", 10);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 200, 1), 1000);
  bindings.push(limit);
  const rows = await context.env.DB.prepare(
    `SELECT sequence, event_type, occurred_at, device_id, aggregate_type, aggregate_id,
            aggregate_version, payload_json
       FROM operational_events WHERE ${conditions.join(" AND ")}
      ORDER BY sequence DESC LIMIT ?${bindings.length}`,
  )
    .bind(...bindings)
    .all<{
      sequence: number;
      event_type: string;
      occurred_at: string;
      device_id: string;
      aggregate_type: string;
      aggregate_id: string;
      aggregate_version: number;
      payload_json: string;
    }>();
  return context.json({
    entries: rows.results.map((row) => ({
      sequence: row.sequence,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      deviceId: row.device_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      aggregateVersion: row.aggregate_version,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    })),
  });
});

app.on("GET", eventRoutes("/history/operations"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const parsedQuery = operationalHistoryQuerySchema.safeParse({
    ticketId: context.req.query("ticketId"),
    ticketGroupId: context.req.query("ticketGroupId"),
    rotationId: context.req.query("rotationId"),
    flightGroupId: context.req.query("flightGroupId"),
    aircraftId: context.req.query("aircraftId"),
    pilotId: context.req.query("pilotId"),
    productId: context.req.query("productId"),
    resourceGroupId: context.req.query("resourceGroupId"),
    gateId: context.req.query("gateId"),
    communicationNumber: context.req.query("communicationNumber"),
    ticketStatus: context.req.query("ticketStatus"),
    rotationStatus: context.req.query("rotationStatus"),
    since: context.req.query("since"),
    until: context.req.query("until"),
    limit: context.req.query("limit"),
    offset: context.req.query("offset"),
  });
  if (!parsedQuery.success) {
    return context.json(
      {
        error: {
          code: "HISTORY_FILTERS_INVALID",
          message: "Die Historienfilter sind ungültig.",
        },
      },
      400,
    );
  }
  const statement = buildOperationalHistoryStatement(eventId, parsedQuery.data);
  const rows = await context.env.DB.prepare(statement.sql)
    .bind(...statement.bindings)
    .all<{
      ticket_id: string;
      ticket_group_id: string;
      ticket_status: string;
      sold_at: string;
      assigned_at: string | null;
      released_at: string | null;
      rotation_id: string | null;
      rotation_status: string | null;
      flight_group_id: string | null;
      communication_number: number | null;
      resource_group_short_code: string | null;
      product_id: string;
      product_code: string;
      product_name: string;
      resource_group_id: string;
      resource_group_name: string;
      gate_id: string | null;
      gate_label: string | null;
      aircraft_id: string | null;
      aircraft_registration: string | null;
      pilot_id: string | null;
      pilot_operational_code: string | null;
      called_at: string | null;
      departed_at: string | null;
      landed_at: string | null;
      completed_at: string | null;
      latest_at: string;
      total_count: number;
    }>();
  const query = parsedQuery.data;
  return context.json(
    operationalHistorySchema.parse({
      entries: rows.results.map((row) => ({
        ticketId: row.ticket_id,
        ticketGroupId: row.ticket_group_id,
        ticketStatus: row.ticket_status,
        soldAt: row.sold_at,
        assignmentActive: row.assigned_at !== null && row.released_at === null,
        assignedAt: row.assigned_at,
        releasedAt: row.released_at,
        rotationId: row.rotation_id,
        rotationStatus: row.rotation_status,
        flightGroupId: row.flight_group_id,
        communicationNumber: row.communication_number,
        communicationLabel:
          row.communication_number === null || row.resource_group_short_code === null
            ? null
            : formatFlightGroupLabel(row.resource_group_short_code, row.communication_number),
        productId: row.product_id,
        productCode: row.product_code,
        productName: row.product_name,
        resourceGroupId: row.resource_group_id,
        resourceGroupName: row.resource_group_name,
        gateId: row.gate_id,
        gateLabel: row.gate_label,
        aircraftId: row.aircraft_id,
        aircraftRegistration: row.aircraft_registration,
        pilotId: row.pilot_id,
        pilotOperationalCode: row.pilot_operational_code,
        calledAt: row.called_at,
        departedAt: row.departed_at,
        landedAt: row.landed_at,
        completedAt: row.completed_at,
        latestAt: row.latest_at,
      })),
      total: rows.results[0]?.total_count ?? 0,
      limit: query.limit,
      offset: query.offset,
    }),
  );
});

app.on("GET", eventRoutes("/history/forecasts"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const parsedQuery = forecastHistoryQuerySchema.safeParse({
    rotationId: context.req.query("rotationId"),
    aircraftId: context.req.query("aircraftId"),
    pilotId: context.req.query("pilotId"),
    since: context.req.query("since"),
    until: context.req.query("until"),
    limit: context.req.query("limit"),
    offset: context.req.query("offset"),
  });
  if (!parsedQuery.success) {
    return context.json(
      {
        error: {
          code: "FORECAST_FILTERS_INVALID",
          message: "Die Prognosefilter sind ungültig.",
        },
      },
      400,
    );
  }
  const statement = buildForecastHistoryStatement(eventId, parsedQuery.data);
  const rows = await context.env.DB.prepare(statement.sql)
    .bind(...statement.bindings)
    .all<{
      snapshot_id: string;
      rotation_id: string;
      flight_group_id: string;
      communication_number: number;
      resource_group_short_code: string;
      aircraft_id: string | null;
      aircraft_registration: string | null;
      pilot_id: string | null;
      pilot_operational_code: string | null;
      operation_day_version: number;
      captured_at: string;
      trigger_event_type: string;
      quality: string;
      lower_minutes: number;
      upper_minutes: number;
      data_basis_scope: string;
      sample_size: number;
      data_age_minutes: number;
      active_capacity: number;
      reference_duration_minutes: number;
      product_id: string | null;
      assumed_aircraft_id: string | null;
      boarding_minutes: number | null;
      deboarding_minutes: number | null;
      buffer_minutes: number | null;
      boarding_source: string;
      deboarding_source: string;
      buffer_source: string;
      dispatch_plan_id: string | null;
      dispatch_plan_revision: string | null;
      dispatch_batch_id: string | null;
      dispatch_order: number | null;
      dispatch_wave: number | null;
      dispatch_lane_id: string | null;
      dispatch_group_ids_json: string;
      dispatch_occupied_seats: number | null;
      dispatch_available_seats: number | null;
      dispatch_commitment_level: "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE" | null;
      dispatch_decision_reasons_json: string;
      dispatch_confirmed_overtake_count: number;
      dispatch_projected_overtake_count: number;
      dispatch_unplanned_reason:
        | "NO_FORECAST_CAPACITY"
        | "WAITING_FOR_FITTING_LANE"
        | "WAITING_FOR_PRODUCT_FAIRNESS"
        | "NOT_IN_NEAR_DISPATCH_BATCH"
        | "COMMITMENT_LOCKED"
        | "ATTENDANCE_MISSING"
        | "ATTENDANCE_CLARIFICATION"
        | "UNKNOWN_RESOURCE_RETURN"
        | null;
      predicted_boarding_at: string | null;
      predicted_departure_at: string | null;
      predicted_landing_at: string | null;
      predicted_completion_at: string | null;
      called_at: string | null;
      departed_at: string | null;
      landed_at: string | null;
      completed_at: string | null;
      boarding_deviation_minutes: number | null;
      departure_deviation_minutes: number | null;
      landing_deviation_minutes: number | null;
      completion_deviation_minutes: number | null;
      total_count: number;
    }>();
  const query = parsedQuery.data;
  return context.json(
    forecastHistorySchema.parse({
      entries: rows.results.map((row) => ({
        snapshotId: row.snapshot_id,
        rotationId: row.rotation_id,
        flightGroupId: row.flight_group_id,
        communicationNumber: row.communication_number,
        communicationLabel: formatFlightGroupLabel(
          row.resource_group_short_code,
          row.communication_number,
        ),
        aircraftId: row.aircraft_id,
        aircraftRegistration: row.aircraft_registration,
        pilotId: row.pilot_id,
        pilotOperationalCode: row.pilot_operational_code,
        operationDayVersion: row.operation_day_version,
        capturedAt: row.captured_at,
        triggerEventType: row.trigger_event_type,
        quality: row.quality,
        lowerMinutes: row.lower_minutes,
        upperMinutes: row.upper_minutes,
        dataBasisScope: row.data_basis_scope,
        sampleSize: row.sample_size,
        dataAgeMinutes: row.data_age_minutes,
        activeCapacity: row.active_capacity,
        referenceDurationMinutes: row.reference_duration_minutes,
        productId: row.product_id,
        assumedAircraftId: row.assumed_aircraft_id,
        turnaroundProfile: {
          boardingMinutes: row.boarding_minutes,
          deboardingMinutes: row.deboarding_minutes,
          bufferMinutes: row.buffer_minutes,
          boardingSource: row.boarding_source,
          deboardingSource: row.deboarding_source,
          bufferSource: row.buffer_source,
        },
        dispatchPlan: {
          planId: row.dispatch_plan_id,
          revision: row.dispatch_plan_revision,
          batchId: row.dispatch_batch_id,
          dispatchOrder: row.dispatch_order,
          wave: row.dispatch_wave,
          laneId: row.dispatch_lane_id,
          groupIds: JSON.parse(row.dispatch_group_ids_json) as string[],
          occupiedSeats: row.dispatch_occupied_seats,
          availableSeats: row.dispatch_available_seats,
          commitmentLevel: row.dispatch_commitment_level,
          decisionReasons: JSON.parse(row.dispatch_decision_reasons_json) as string[],
          confirmedOvertakeCount: row.dispatch_confirmed_overtake_count,
          projectedOvertakeCount: row.dispatch_projected_overtake_count,
          unplannedReason: row.dispatch_unplanned_reason,
        },
        predicted: {
          boardingAt: row.predicted_boarding_at,
          departureAt: row.predicted_departure_at,
          landingAt: row.predicted_landing_at,
          completionAt: row.predicted_completion_at,
        },
        actual: {
          boardingAt: row.called_at,
          departureAt: row.departed_at,
          landingAt: row.landed_at,
          completionAt: row.completed_at,
        },
        deviationMinutes: {
          boarding: row.boarding_deviation_minutes,
          departure: row.departure_deviation_minutes,
          landing: row.landing_deviation_minutes,
          completion: row.completion_deviation_minutes,
        },
      })),
      total: rows.results[0]?.total_count ?? 0,
      limit: query.limit,
      offset: query.offset,
    }),
  );
});

app.on("GET", eventRoutes("/history/resources"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const parsedQuery = resourceDayHistoryQuerySchema.safeParse({
    scopeType: context.req.query("scopeType"),
    scopeId: context.req.query("scopeId"),
  });
  if (!parsedQuery.success) {
    return context.json(
      {
        error: {
          code: "RESOURCE_HISTORY_FILTERS_INVALID",
          message: "Die Ressourcenfilter sind ungültig.",
        },
      },
      400,
    );
  }

  const event = await context.env.DB.prepare(
    `SELECT event_date, time_zone, sale_opens_at, operations_start_at, operations_end_at
       FROM operation_days
      WHERE id = ?1`,
  )
    .bind(eventId)
    .first<{
      event_date: string;
      time_zone: string;
      sale_opens_at: string | null;
      operations_start_at: string | null;
      operations_end_at: string | null;
    }>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }

  const query = parsedQuery.data;
  const resource =
    query.scopeType === "AIRCRAFT"
      ? await context.env.DB.prepare(
          `SELECT a.id
             FROM aircraft a
            WHERE a.id = ?1
              AND EXISTS (
                SELECT 1
                  FROM resource_group_memberships rgm
                 WHERE rgm.operation_day_id = ?2 AND rgm.aircraft_id = a.id
              )`,
        )
          .bind(query.scopeId, eventId)
          .first<{ id: string }>()
      : await context.env.DB.prepare(
          `SELECT id FROM pilots WHERE id = ?1 AND operation_day_id = ?2`,
        )
          .bind(query.scopeId, eventId)
          .first<{ id: string }>();
  if (!resource) {
    return context.json(
      { error: { code: "RESOURCE_NOT_FOUND", message: "Ressource nicht gefunden." } },
      404,
    );
  }

  const window = buildEventDayWindow({
    eventDate: event.event_date,
    timeZone: event.time_zone,
    saleOpensAt: event.sale_opens_at,
    operationsStartAt: event.operations_start_at,
    operationsEndAt: event.operations_end_at,
    observedAt: new Date().toISOString(),
  });
  const rotationStatement = buildResourceDayRotationStatement(
    eventId,
    query,
    window.from,
    window.observedUntil,
  );
  const rotations = await context.env.DB.prepare(rotationStatement.sql)
    .bind(...rotationStatement.bindings)
    .all<{
      rotation_id: string;
      flight_group_id: string;
      communication_number: number;
      resource_group_id: string;
      resource_group_name: string;
      resource_group_short_code: string;
      product_name: string;
      passenger_count: number;
      usable_capacity: number;
      aircraft_id: string | null;
      aircraft_registration: string | null;
      pilot_id: string | null;
      pilot_operational_code: string | null;
      called_at: string | null;
      departed_at: string | null;
      landed_at: string | null;
      completed_at: string | null;
    }>();

  let blocks: Array<{
    id: string;
    type: "REFUELING" | "PAUSE" | "INTERRUPTION";
    startedAt: string;
    endedAt: string | null;
    active: boolean;
  }>;
  if (query.scopeType === "AIRCRAFT") {
    const statement = buildAircraftBlockStatement(
      eventId,
      query.scopeId,
      window.from,
      window.observedUntil,
    );
    const rows = await context.env.DB.prepare(statement.sql)
      .bind(...statement.bindings)
      .all<{
        id: string;
        block_type: "REFUELING" | "PAUSE" | "INTERRUPTION";
        status: "ACTIVE" | "CLEARED";
        started_at: string;
        cleared_at: string | null;
      }>();
    const fromMs = Date.parse(window.from);
    const observedUntilMs = Date.parse(window.observedUntil);
    blocks = rows.results.map((row) => ({
      id: row.id,
      type: row.block_type,
      startedAt: new Date(Math.max(Date.parse(row.started_at), fromMs)).toISOString(),
      endedAt: row.cleared_at
        ? new Date(Math.min(Date.parse(row.cleared_at), observedUntilMs)).toISOString()
        : null,
      active: row.status === "ACTIVE" && row.cleared_at === null,
    }));
  } else {
    const statement = buildPilotPauseEventStatement(eventId, query.scopeId, window.observedUntil);
    const rows = await context.env.DB.prepare(statement.sql)
      .bind(...statement.bindings)
      .all<{
        id: string;
        sequence: number;
        event_type: "PILOT_PAUSE_STARTED" | "PILOT_PAUSE_ENDED";
        occurred_at: string;
      }>();
    blocks = pairPilotPauseEvents(
      rows.results.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
      })),
      window.from,
      window.observedUntil,
    );
  }

  return context.json(
    resourceDayHistorySchema.parse({
      scopeType: query.scopeType,
      scopeId: query.scopeId,
      from: window.from,
      until: window.until,
      observedUntil: window.observedUntil,
      rotations: rotations.results.map((row) => ({
        rotationId: row.rotation_id,
        flightGroupId: row.flight_group_id,
        communicationNumber: row.communication_number,
        communicationLabel: formatFlightGroupLabel(
          row.resource_group_short_code,
          row.communication_number,
        ),
        resourceGroupId: row.resource_group_id,
        resourceGroupName: row.resource_group_name,
        productName: row.product_name,
        passengerCount: row.passenger_count,
        usableCapacity: row.usable_capacity,
        aircraftId: row.aircraft_id,
        aircraftRegistration: row.aircraft_registration,
        pilotId: row.pilot_id,
        pilotOperationalCode: row.pilot_operational_code,
        actual: {
          boardingAt: row.called_at,
          departureAt: row.departed_at,
          landingAt: row.landed_at,
          completionAt: row.completed_at,
        },
      })),
      blocks,
    }),
  );
});

app.on("GET", eventRoutes("/devices"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (device?.role !== "ADMIN") {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const devices = await context.env.DB.prepare(
    `SELECT id, label, role, active, paired_at, last_seen_at, revoked_at
       FROM paired_devices WHERE operation_day_id = ?1 ORDER BY active DESC, paired_at DESC`,
  )
    .bind(eventId)
    .all<{
      id: string;
      label: string;
      role: string;
      active: number;
      paired_at: string;
      last_seen_at: string;
      revoked_at: string | null;
    }>();
  const now = Date.now();
  return context.json({
    devices: devices.results.map((entry) => ({
      id: entry.id,
      label: entry.label,
      role: entry.role,
      active: entry.active === 1,
      online: entry.active === 1 && now - Date.parse(entry.last_seen_at) <= 120_000,
      pairedAt: entry.paired_at,
      lastSeenAt: entry.last_seen_at,
      revokedAt: entry.revoked_at,
    })),
  });
});

app.on("GET", eventRoutes("/reports/daily.csv"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["ADMIN", "CASHIER"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const report = await loadDailyReport(context.env.DB, eventId);
  if (!report) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const csv = dailyReportCsv(report);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tagesbericht-${eventId}.csv"`,
      "cache-control": "no-store",
    },
  });
});

app.on("GET", eventRoutes("/exports/performance-profile.json"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const event = await context.env.DB.prepare(
    `SELECT name, event_date, aerodrome, time_zone, planned_boarding_minutes,
            planned_deboarding_minutes, planned_buffer_minutes
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<{
      name: string;
      event_date: string;
      aerodrome: string;
      time_zone: string;
      planned_boarding_minutes: number;
      planned_deboarding_minutes: number;
      planned_buffer_minutes: number;
    }>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const groups = await context.env.DB.prepare(
    `SELECT rg.id AS resource_group_id, rg.name AS resource_group_name,
            COUNT(DISTINCT CASE WHEN r.status = 'COMPLETED' THEN r.id END) AS completed_rotations,
            ROUND(AVG(CASE WHEN r.departed_at IS NOT NULL AND r.called_at IS NOT NULL
              THEN (julianday(r.departed_at) - julianday(r.called_at)) * 1440 END), 1)
              AS average_boarding_minutes,
            ROUND(AVG(CASE WHEN r.landed_at IS NOT NULL AND r.departed_at IS NOT NULL
              THEN (julianday(r.landed_at) - julianday(r.departed_at)) * 1440 END), 1)
              AS average_flight_minutes,
            ROUND(AVG(CASE WHEN r.completed_at IS NOT NULL AND r.landed_at IS NOT NULL
              THEN (julianday(r.completed_at) - julianday(r.landed_at)) * 1440 END), 1)
              AS average_turnaround_minutes,
            GROUP_CONCAT(DISTINCT a.aircraft_type) AS aircraft_types,
            GROUP_CONCAT(DISTINCT a.passenger_seats) AS passenger_seat_counts
       FROM resource_groups rg
       LEFT JOIN flight_groups fg ON fg.resource_group_id = rg.id
       LEFT JOIN rotations r ON r.flight_group_id = fg.id
       LEFT JOIN resource_group_memberships m
         ON m.resource_group_id = rg.id AND m.operation_day_id = rg.operation_day_id
       LEFT JOIN aircraft a ON a.id = m.aircraft_id
      WHERE rg.operation_day_id = ?1
      GROUP BY rg.id, rg.name
      ORDER BY rg.name`,
  )
    .bind(eventId)
    .all<{
      resource_group_id: string;
      resource_group_name: string;
      completed_rotations: number;
      average_boarding_minutes: number | null;
      average_flight_minutes: number | null;
      average_turnaround_minutes: number | null;
      aircraft_types: string | null;
      passenger_seat_counts: string | null;
    }>();
  return context.json(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      context: {
        eventName: event.name,
        eventDate: event.event_date,
        aerodrome: event.aerodrome,
        timeZone: event.time_zone,
      },
      planningDefaults: {
        boardingMinutes: event.planned_boarding_minutes,
        deboardingMinutes: event.planned_deboarding_minutes,
        bufferMinutes: event.planned_buffer_minutes,
      },
      resourceGroups: groups.results.map((group) => ({
        id: group.resource_group_id,
        name: group.resource_group_name,
        completedRotations: group.completed_rotations,
        aircraftTypes: group.aircraft_types?.split(",").sort() ?? [],
        passengerSeatCounts:
          group.passenger_seat_counts
            ?.split(",")
            .map(Number)
            .filter(Number.isFinite)
            .sort((left, right) => left - right) ?? [],
        durationsMinutes: {
          boarding: group.average_boarding_minutes,
          flight: group.average_flight_minutes,
          turnaround: group.average_turnaround_minutes,
        },
      })),
    },
    200,
    {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="leistungsprofil-${eventId}.json"`,
    },
  );
});

app.on("GET", eventRoutes("/exports/tickets.csv"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["ADMIN", "CASHIER", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const rows = await context.env.DB.prepare(
    `SELECT t.id AS ticket_id, t.status AS ticket_status, t.weight_class,
            t.payment_method, t.payment_status, t.price_cents, t.created_at,
            tg.id AS ticket_group_id, tg.queue_sequence, tg.standby,
            p.id AS product_id, p.name AS product_name,
            rg.id AS resource_group_id, rg.name AS resource_group_name,
            fg.communication_number, r.id AS rotation_id, r.status AS rotation_status,
            a.registration, pl.operational_code AS pilot_code,
            r.called_at, r.departed_at, r.landed_at, r.completed_at
       FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN products p ON p.id = tg.product_id
       JOIN resource_groups rg ON rg.id = p.resource_group_id
       LEFT JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
       LEFT JOIN rotations r ON r.id = rt.rotation_id
       LEFT JOIN flight_groups fg ON fg.id = r.flight_group_id
       LEFT JOIN aircraft a ON a.id = r.aircraft_id
       LEFT JOIN pilots pl ON pl.id = r.pilot_id
      WHERE tg.operation_day_id = ?1
      ORDER BY t.created_at, t.id`,
  )
    .bind(eventId)
    .all<Record<string, string | number | null>>();
  const columns = [
    "ticket_id",
    "ticket_status",
    "weight_class",
    "payment_method",
    "payment_status",
    "price_cents",
    "created_at",
    "ticket_group_id",
    "queue_sequence",
    "standby",
    "product_id",
    "product_name",
    "resource_group_id",
    "resource_group_name",
    "communication_number",
    "rotation_id",
    "rotation_status",
    "registration",
    "pilot_code",
    "called_at",
    "departed_at",
    "landed_at",
    "completed_at",
  ];
  return new Response(
    createCsv([
      columns,
      ...rows.results.map((row) => columns.map((column) => row[column] ?? null)),
    ]),
    {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rohdaten-tickets-${eventId}.csv"`,
        "cache-control": "no-store",
      },
    },
  );
});

app.on("GET", eventRoutes("/reports/daily.pdf"), async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(context.env, eventId, context.req.raw);
  if (!device || !["ADMIN", "CASHIER", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      {
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      },
      403,
    );
  }
  const report = await loadDailyReport(context.env.DB, eventId);
  if (!report)
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  const pdf = createTextPdf(`Tagesbericht ${report.summary.name}`, dailyReportPdfLines(report));
  return new Response(
    pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer,
    {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="tagesbericht-${eventId}.pdf"`,
        "cache-control": "no-store",
      },
    },
  );
});

registerPublicInstallRoutes(app);

app.get("/api/public/tickets/:ticketCode", async (context) => {
  const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
  if (!/^[A-Z2-9]{12,32}$/.test(ticketCode)) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  const ticketHash = await sha256Hex(ticketCode);
  const row = await context.env.DB.prepare(
    withBookingGroupPartProjection(
      `SELECT p.name AS product_name, p.code AS product_code, p.public_description,
            g.label AS gate_label,
            COALESCE(tg.communication_number, fg.communication_number) AS communication_number,
            part.part_number, part.part_count, part.passenger_count,
            fg.precalled_at, fg.precall_decision_status, r.status, tg.operation_day_id,
            COALESCE(fg.queue_position, tg.queue_sequence) AS queue_sequence,
            r.predicted_boarding_at, r.predicted_completion_at, r.prediction_quality,
            r.prediction_lower_minutes, r.prediction_upper_minutes,
            r.prediction_updated_at, r.dispatch_batch_id, r.dispatch_unplanned_reason,
            od.name AS event_name, od.time_zone,
            od.operational_note AS event_operational_note, od.operational_interrupted,
            od.emergency_mode, od.notification_lead_minutes, od.operations_end_at,
            rg.status AS resource_group_status,
            rg.operational_note AS resource_group_operational_note,
            recall.id AS recall_id, recall.sequence AS recall_sequence,
            recall.started_at AS recall_started_at, recall.expires_at AS recall_expires_at,
            (SELECT plan.public_note FROM planned_operational_constraints plan
              WHERE plan.operation_day_id = od.id AND plan.status = 'ACTIVE'
                AND plan.public_note <> ''
                AND ((plan.scope_type = 'RESOURCE_GROUP' AND plan.scope_id = rg.id)
                  OR (plan.scope_type = 'EVENT' AND plan.scope_id = od.id))
              ORDER BY CASE plan.scope_type WHEN 'RESOURCE_GROUP' THEN 0 ELSE 1 END,
                       plan.activated_at DESC LIMIT 1) AS planned_public_note,
            od.updated_at
       FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN products p ON p.id = tg.product_id
       JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
       JOIN rotations r ON r.id = rt.rotation_id
       JOIN booking_group_parts part
         ON part.ticket_group_id = tg.id AND part.rotation_id = r.id
       JOIN gates g ON g.id = COALESCE(r.gate_id, p.gate_id)
       JOIN flight_groups fg ON fg.id = r.flight_group_id
       JOIN resource_groups rg ON rg.id = fg.resource_group_id
       JOIN operation_days od ON od.id = tg.operation_day_id
       LEFT JOIN ticket_group_recalls recall
         ON recall.ticket_group_id = tg.id
        AND recall.ended_at IS NULL
        AND recall.expires_at > ?2
      WHERE t.public_code_hash = ?1`,
    ),
  )
    .bind(ticketHash, new Date().toISOString())
    .first<{
      product_name: string;
      product_code: string;
      public_description: string;
      gate_label: string;
      communication_number: number;
      part_number: number;
      part_count: number;
      passenger_count: number;
      precalled_at: string | null;
      precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
      status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      operation_day_id: string;
      queue_sequence: number;
      predicted_boarding_at: string | null;
      predicted_completion_at: string | null;
      prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
      prediction_lower_minutes: number | null;
      prediction_upper_minutes: number | null;
      prediction_updated_at: string | null;
      dispatch_batch_id: string | null;
      dispatch_unplanned_reason:
        | "NO_FORECAST_CAPACITY"
        | "WAITING_FOR_FITTING_LANE"
        | "WAITING_FOR_PRODUCT_FAIRNESS"
        | "NOT_IN_NEAR_DISPATCH_BATCH"
        | "COMMITMENT_LOCKED"
        | "ATTENDANCE_MISSING"
        | "ATTENDANCE_CLARIFICATION"
        | "UNKNOWN_RESOURCE_RETURN"
        | null;
      updated_at: string;
      event_name: string;
      time_zone: string;
      event_operational_note: string;
      resource_group_operational_note: string;
      planned_public_note: string | null;
      operational_interrupted: number;
      emergency_mode: number;
      notification_lead_minutes: number;
      operations_end_at: string | null;
      resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
      recall_id: string | null;
      recall_sequence: number | null;
      recall_started_at: string | null;
      recall_expires_at: string | null;
    }>();
  if (!row) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  const forecastFreshness = assessForecastFreshness({
    predictionQuality: row.prediction_quality,
    predictionUpdatedAt: row.prediction_updated_at,
    now: new Date().toISOString(),
  });
  const effectivePredictionQuality =
    row.emergency_mode === 1 ||
    row.operational_interrupted === 1 ||
    row.resource_group_status === "INTERRUPTED" ||
    row.resource_group_status === "ENDED"
      ? "UNCERTAIN"
      : forecastFreshness.quality;
  const prepare =
    row.status === "DRAFT" &&
    row.resource_group_status === "ACTIVE" &&
    row.operational_interrupted === 0 &&
    effectivePredictionQuality !== "UNCERTAIN" &&
    row.precall_decision_status === "PREPARE";
  const publicStatus = derivePublicRotationStatus({
    rotationState: row.status,
    draftStatus: row.precalled_at ? "COME_TO_FLIGHT_LINE" : prepare ? "PREPARE" : "WAITING",
  });
  const servicePaused =
    row.emergency_mode === 1 ||
    row.operational_interrupted === 1 ||
    row.resource_group_status !== "ACTIVE";
  const lowerMinutes = row.prediction_lower_minutes ?? Math.max(0, (row.queue_sequence - 1) * 20);
  const upperMinutes = row.prediction_upper_minutes ?? row.queue_sequence * 30;
  const boardingWindow = predictedBoardingWindow({
    status: row.status,
    quality: effectivePredictionQuality,
    predictedBoardingAt: row.predicted_boarding_at,
    lowerMinutes,
    upperMinutes,
    referenceAt: new Date().toISOString(),
  });
  const publicForecast = derivePublicForecastProjection({
    rotationStatus: row.status,
    predictionQuality: effectivePredictionQuality,
    predictedBoardingAt: row.predicted_boarding_at,
    predictedCompletionAt: row.predicted_completion_at,
    operationsEndAt: row.operations_end_at,
    dispatchBatchId: row.dispatch_batch_id,
    dispatchUnplannedReason: row.dispatch_unplanned_reason,
    emergencyMode: row.emergency_mode === 1,
    operationalInterrupted: row.operational_interrupted === 1,
    resourceGroupStatus: row.resource_group_status,
  });
  const publishesWindow =
    publicForecast.forecastState === "DISPATCH_WINDOW" ||
    publicForecast.forecastState === "LONG_RANGE_WINDOW";
  return context.json({
    eventId: row.operation_day_id,
    eventName: row.event_name,
    productName: row.product_name,
    productCode: row.product_code,
    publicDescription: row.public_description,
    gateLabel: row.gate_label,
    communicationNumber: row.communication_number,
    bookingGroupPart: bookingGroupPartContextFromColumns(row),
    status: servicePaused ? "SERVICE_PAUSED" : publicStatus,
    queuePosition: row.emergency_mode === 0 && row.status === "DRAFT" ? row.queue_sequence : null,
    waitLowerMinutes:
      row.emergency_mode === 0 &&
      row.resource_group_status === "ACTIVE" &&
      row.status === "DRAFT" &&
      row.operational_interrupted === 0 &&
      publishesWindow
        ? lowerMinutes
        : 0,
    waitUpperMinutes:
      row.emergency_mode === 0 &&
      row.resource_group_status === "ACTIVE" &&
      row.status === "DRAFT" &&
      row.operational_interrupted === 0 &&
      publishesWindow
        ? upperMinutes
        : 0,
    boardingWindowLowerAt: publishesWindow ? boardingWindow.lowerAt : null,
    boardingWindowUpperAt: publishesWindow ? boardingWindow.upperAt : null,
    ...publicForecast,
    timeZone: row.time_zone,
    predictionQuality: effectivePredictionQuality,
    message: servicePaused
      ? publicServicePausedMessage({
          emergencyMode: row.emergency_mode === 1,
          resourceGroupActive: row.resource_group_status === "ACTIVE",
          operationalInterrupted: row.operational_interrupted === 1,
        })
      : forecastFreshness.reason === "STALE_PREDICTION"
        ? "Prognose wird aktualisiert – bitte Status erneut prüfen."
        : PUBLIC_STATUS_MESSAGES[publicStatus],
    operationalNotice:
      row.planned_public_note || row.resource_group_operational_note || row.event_operational_note,
    activeRecall: activeTicketGroupRecallProjection(row),
    updatedAt: row.updated_at,
  });
});

app.get("/api/public/groups/:groupCode", async (context) => {
  const groupCode = context.req.param("groupCode").trim().toUpperCase();
  if (!/^[A-Z2-9]{12,32}$/.test(groupCode)) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  const group = await context.env.DB.prepare(
    `SELECT tg.id, tg.communication_number, tg.operation_day_id,
            p.name AS product_name, p.code AS product_code, p.public_description,
            g.label AS gate_label,
            od.name AS event_name, od.time_zone, od.operational_note AS event_operational_note,
            od.operational_interrupted, od.emergency_mode, od.notification_lead_minutes,
            od.operations_end_at,
            od.updated_at, rg.status AS resource_group_status,
            rg.operational_note AS resource_group_operational_note,
            recall.id AS recall_id, recall.sequence AS recall_sequence,
            recall.started_at AS recall_started_at, recall.expires_at AS recall_expires_at,
            (SELECT plan.public_note FROM planned_operational_constraints plan
              WHERE plan.operation_day_id = od.id AND plan.status = 'ACTIVE'
                AND plan.public_note <> ''
                AND ((plan.scope_type = 'RESOURCE_GROUP' AND plan.scope_id = rg.id)
                  OR (plan.scope_type = 'EVENT' AND plan.scope_id = od.id))
              ORDER BY CASE plan.scope_type WHEN 'RESOURCE_GROUP' THEN 0 ELSE 1 END,
                       plan.activated_at DESC LIMIT 1) AS planned_public_note,
            (SELECT COUNT(*) FROM tickets t WHERE t.ticket_group_id = tg.id) AS group_size
       FROM ticket_groups tg
       JOIN products p ON p.id = tg.product_id
       JOIN gates g ON g.id = p.gate_id
       JOIN resource_groups rg ON rg.id = p.resource_group_id
       JOIN operation_days od ON od.id = tg.operation_day_id
       LEFT JOIN ticket_group_recalls recall
         ON recall.ticket_group_id = tg.id
        AND recall.ended_at IS NULL
        AND recall.expires_at > ?2
      WHERE tg.public_status_code_hash = ?1 AND tg.status <> 'CANCELED'`,
  )
    .bind(await sha256Hex(groupCode), new Date().toISOString())
    .first<{
      id: string;
      communication_number: number;
      operation_day_id: string;
      product_name: string;
      product_code: string;
      public_description: string;
      gate_label: string;
      event_name: string;
      time_zone: string;
      event_operational_note: string;
      operational_interrupted: number;
      emergency_mode: number;
      notification_lead_minutes: number;
      operations_end_at: string | null;
      updated_at: string;
      resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
      resource_group_operational_note: string;
      planned_public_note: string | null;
      group_size: number;
      recall_id: string | null;
      recall_sequence: number | null;
      recall_started_at: string | null;
      recall_expires_at: string | null;
    }>();
  if (!group) {
    return unknownTicketResponse(context.env, context.req.raw);
  }

  const rotations = await context.env.DB.prepare(
    withBookingGroupPartProjection(
      `SELECT r.id, r.status, r.predicted_boarding_at, r.predicted_completion_at,
            r.prediction_quality,
            r.prediction_lower_minutes, r.prediction_upper_minutes, r.prediction_updated_at,
            r.dispatch_batch_id, r.dispatch_unplanned_reason,
            fg.precalled_at, fg.precall_decision_status,
            COALESCE(fg.queue_position, fg.communication_number) AS queue_position,
            g.label AS gate_label, part.part_number, part.part_count, part.passenger_count
       FROM booking_group_parts part
       JOIN rotations r ON r.id = part.rotation_id
       JOIN flight_groups fg ON fg.id = r.flight_group_id
       JOIN ticket_groups part_tg ON part_tg.id = part.ticket_group_id
       JOIN products part_product ON part_product.id = part_tg.product_id
       JOIN gates g ON g.id = COALESCE(r.gate_id, part_product.gate_id)
      WHERE part.ticket_group_id = ?1
      ORDER BY part.part_number`,
    ),
  )
    .bind(group.id)
    .all<{
      id: string;
      status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      predicted_boarding_at: string | null;
      predicted_completion_at: string | null;
      prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
      prediction_lower_minutes: number | null;
      prediction_upper_minutes: number | null;
      prediction_updated_at: string | null;
      dispatch_batch_id: string | null;
      dispatch_unplanned_reason:
        | "NO_FORECAST_CAPACITY"
        | "WAITING_FOR_FITTING_LANE"
        | "WAITING_FOR_PRODUCT_FAIRNESS"
        | "NOT_IN_NEAR_DISPATCH_BATCH"
        | "COMMITMENT_LOCKED"
        | "ATTENDANCE_MISSING"
        | "ATTENDANCE_CLARIFICATION"
        | "UNKNOWN_RESOURCE_RETURN"
        | null;
      precalled_at: string | null;
      precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
      queue_position: number;
      gate_label: string;
      part_number: number;
      part_count: number;
      passenger_count: number;
    }>();
  if (rotations.results.length === 0) {
    return unknownTicketResponse(context.env, context.req.raw);
  }

  const readAt = new Date().toISOString();
  const servicePaused =
    group.emergency_mode === 1 ||
    group.operational_interrupted === 1 ||
    group.resource_group_status !== "ACTIVE";
  const parts = rotations.results.map((rotation) => {
    const freshness = assessForecastFreshness({
      predictionQuality: rotation.prediction_quality,
      predictionUpdatedAt: rotation.prediction_updated_at,
      now: readAt,
    });
    const predictionQuality =
      group.emergency_mode === 1 ||
      group.operational_interrupted === 1 ||
      group.resource_group_status === "INTERRUPTED" ||
      group.resource_group_status === "ENDED"
        ? "UNCERTAIN"
        : freshness.quality;
    const lowerMinutes =
      rotation.prediction_lower_minutes ?? Math.max(0, (rotation.queue_position - 1) * 20);
    const upperMinutes =
      rotation.prediction_upper_minutes ?? Math.max(lowerMinutes, rotation.queue_position * 30);
    const prepare =
      rotation.status === "DRAFT" &&
      predictionQuality !== "UNCERTAIN" &&
      rotation.precall_decision_status === "PREPARE";
    const lifecycleStatus = derivePublicRotationStatus({
      rotationState: rotation.status,
      draftStatus: rotation.precalled_at ? "COME_TO_FLIGHT_LINE" : prepare ? "PREPARE" : "WAITING",
    });
    const publicStatus = servicePaused ? ("SERVICE_PAUSED" as const) : lifecycleStatus;
    const lifecycleMessage = PUBLIC_STATUS_MESSAGES[lifecycleStatus];
    const boardingWindow = predictedBoardingWindow({
      status: rotation.status,
      quality: predictionQuality,
      predictedBoardingAt: rotation.predicted_boarding_at,
      lowerMinutes,
      upperMinutes,
      referenceAt: readAt,
    });
    const publicForecast = derivePublicForecastProjection({
      rotationStatus: rotation.status,
      predictionQuality,
      predictedBoardingAt: rotation.predicted_boarding_at,
      predictedCompletionAt: rotation.predicted_completion_at,
      operationsEndAt: group.operations_end_at,
      dispatchBatchId: rotation.dispatch_batch_id,
      dispatchUnplannedReason: rotation.dispatch_unplanned_reason,
      emergencyMode: group.emergency_mode === 1,
      operationalInterrupted: group.operational_interrupted === 1,
      resourceGroupStatus: group.resource_group_status,
    });
    const publishesWindow =
      publicForecast.forecastState === "DISPATCH_WINDOW" ||
      publicForecast.forecastState === "LONG_RANGE_WINDOW";
    const message = servicePaused
      ? publicServicePausedMessage({
          emergencyMode: group.emergency_mode === 1,
          resourceGroupActive: group.resource_group_status === "ACTIVE",
          operationalInterrupted: group.operational_interrupted === 1,
        })
      : freshness.reason === "STALE_PREDICTION"
        ? "Prognose wird aktualisiert – bitte Status erneut prüfen."
        : lifecycleMessage;
    const partContext = bookingGroupPartContextFromColumns(rotation);
    if (!partContext) {
      throw new Error("Canonical booking group part projection is incomplete.");
    }
    return {
      ...partContext,
      gateLabel: rotation.gate_label,
      status: publicStatus,
      queuePosition: rotation.status === "DRAFT" ? rotation.queue_position : null,
      boardingWindowLowerAt: publishesWindow ? boardingWindow.lowerAt : null,
      boardingWindowUpperAt: publishesWindow ? boardingWindow.upperAt : null,
      ...publicForecast,
      predictionQuality,
      message,
    };
  });

  return context.json({
    eventId: group.operation_day_id,
    eventName: group.event_name,
    bookingGroupLabel: formatBookingGroupLabel(group.product_code, group.communication_number),
    groupSize: group.group_size,
    productName: group.product_name,
    productCode: group.product_code,
    publicDescription: group.public_description,
    timeZone: group.time_zone,
    operationalNotice:
      group.planned_public_note ||
      group.resource_group_operational_note ||
      group.event_operational_note,
    activeRecall: activeTicketGroupRecallProjection(group),
    updatedAt: group.updated_at,
    parts,
  });
});

app.get("/api/public/push/config", (context) => {
  // Ein öffentlicher Schlüssel allein macht noch keinen Versand möglich: Ohne privaten Schlüssel
  // und Betreiberkontakt bliebe jede Einwilligung folgenlos.
  const vapid = vapidConfiguration(context.env);
  if (!vapid) {
    return context.json(
      { error: { code: "PUSH_NOT_CONFIGURED", message: "Web-Push ist noch nicht eingerichtet." } },
      503,
    );
  }
  return context.json({
    publicKey: vapid.publicKey,
    retentionDays: pushRetentionDays(context.env.PUSH_RETENTION_DAYS),
  });
});

app.post("/api/public/push/subscriptions/refresh", async (context) => {
  const body = await context.req.json<{
    previousEndpoint?: string;
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  }>();
  if (
    typeof body.previousEndpoint !== "string" ||
    !isAllowedPushEndpoint(body.previousEndpoint) ||
    typeof body.endpoint !== "string" ||
    !isAllowedPushEndpoint(body.endpoint) ||
    typeof body.keys?.p256dh !== "string" ||
    typeof body.keys.auth !== "string"
  ) {
    return context.json(
      {
        error: { code: "INVALID_PUSH_SUBSCRIPTION", message: "Push-Erneuerung ist ungültig." },
      },
      400,
    );
  }
  const now = new Date().toISOString();
  const [, renewal] = await context.env.DB.batch([
    // Ein verwaistes Ziel auf dem neuen Endpunkt würde dessen Eindeutigkeit verletzen.
    context.env.DB.prepare(
      "DELETE FROM web_push_subscriptions WHERE endpoint = ?1 AND endpoint <> ?2",
    ).bind(body.endpoint, body.previousEndpoint),
    context.env.DB.prepare(
      `UPDATE web_push_subscriptions
          SET endpoint = ?1, p256dh = ?2, auth = ?3, updated_at = ?4
        WHERE endpoint = ?5 AND status = 'ACTIVE' AND delete_after > ?4`,
    ).bind(body.endpoint, body.keys.p256dh, body.keys.auth, now, body.previousEndpoint),
  ]);
  if ((renewal?.meta.changes ?? 0) === 0) {
    return context.json(
      {
        error: {
          code: "PUSH_SUBSCRIPTION_NOT_FOUND",
          message: "Für dieses Push-Ziel liegt keine gültige Einwilligung vor.",
        },
      },
      404,
    );
  }
  return context.json({ active: true, updatedAt: now });
});

app.post("/api/public/tickets/:ticketCode/push-subscriptions", async (context) => {
  const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
  if (!/^[A-Z2-9]{12,32}$/.test(ticketCode)) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  const body = await context.req.json<{
    consent?: boolean;
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  }>();
  if (
    body.consent !== true ||
    typeof body.endpoint !== "string" ||
    !isAllowedPushEndpoint(body.endpoint) ||
    typeof body.keys?.p256dh !== "string" ||
    typeof body.keys.auth !== "string"
  ) {
    return context.json(
      { error: { code: "INVALID_PUSH_SUBSCRIPTION", message: "Push-Einwilligung ist ungültig." } },
      400,
    );
  }
  const ticket = await context.env.DB.prepare(
    `SELECT t.id, tg.id AS ticket_group_id, tg.operation_day_id,
            od.operations_end_at, rt.rotation_id FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN operation_days od ON od.id = tg.operation_day_id
       JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
      WHERE t.public_code_hash = ?1 AND t.status <> 'CANCELED'`,
  )
    .bind(await sha256Hex(ticketCode))
    .first<{
      id: string;
      ticket_group_id: string;
      operation_day_id: string;
      operations_end_at: string | null;
      rotation_id: string;
    }>();
  if (!ticket) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  if (!ticket.operations_end_at) {
    return context.json(
      {
        error: {
          code: "PUSH_RETENTION_UNCONFIGURED",
          message: "Web-Push ist erst nach Festlegung des Veranstaltungsendes verfügbar.",
        },
      },
      409,
    );
  }
  const now = new Date();
  const deleteAfter = pushDeleteAfter(
    ticket.operations_end_at,
    pushRetentionDays(context.env.PUSH_RETENTION_DAYS),
  );
  if (Date.parse(deleteAfter) <= now.getTime()) {
    return context.json(
      {
        error: {
          code: "PUSH_RETENTION_EXPIRED",
          message: "Für diese Veranstaltung werden keine Push-Ziele mehr gespeichert.",
        },
      },
      409,
    );
  }
  await context.env.DB.prepare(
    `INSERT INTO web_push_subscriptions
       (id, operation_day_id, ticket_id, ticket_group_id, target_kind, endpoint, p256dh, auth,
        consented_at, delete_after, status, updated_at, origin)
     VALUES (?1, ?2, ?3, ?4, 'TICKET', ?5, ?6, ?7, ?8, ?9, 'ACTIVE', ?8, ?10)
     ON CONFLICT(endpoint) DO UPDATE SET ticket_id = excluded.ticket_id,
       ticket_group_id = excluded.ticket_group_id, operation_day_id = excluded.operation_day_id,
       target_kind = excluded.target_kind, p256dh = excluded.p256dh, auth = excluded.auth,
       consented_at = excluded.consented_at, delete_after = excluded.delete_after,
       origin = excluded.origin, status = 'ACTIVE', updated_at = excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(),
      ticket.operation_day_id,
      ticket.id,
      ticket.ticket_group_id,
      body.endpoint,
      body.keys.p256dh,
      body.keys.auth,
      now.toISOString(),
      deleteAfter,
      new URL(context.req.url).origin,
    )
    .run();
  const preparationQueued = await queueEligiblePreparationNotifications(
    context.env,
    ticket.operation_day_id,
    ticket.rotation_id,
  );
  return context.json(
    {
      active: true,
      consentedAt: now.toISOString(),
      deleteAfter,
      preparationQueued: preparationQueued > 0,
    },
    201,
  );
});

app.post("/api/public/groups/:groupCode/push-subscriptions", async (context) => {
  const groupCode = context.req.param("groupCode").trim().toUpperCase();
  if (!/^[A-Z2-9]{12,32}$/.test(groupCode)) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  const body = await context.req.json<{
    consent?: boolean;
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  }>();
  if (
    body.consent !== true ||
    typeof body.endpoint !== "string" ||
    !isAllowedPushEndpoint(body.endpoint) ||
    typeof body.keys?.p256dh !== "string" ||
    typeof body.keys.auth !== "string"
  ) {
    return context.json(
      { error: { code: "INVALID_PUSH_SUBSCRIPTION", message: "Push-Einwilligung ist ungültig." } },
      400,
    );
  }
  const group = await context.env.DB.prepare(
    `SELECT tg.id, tg.operation_day_id, od.operations_end_at,
            (SELECT t.id FROM tickets t WHERE t.ticket_group_id = tg.id
              ORDER BY t.created_at, t.id LIMIT 1) AS representative_ticket_id
       FROM ticket_groups tg
       JOIN operation_days od ON od.id = tg.operation_day_id
      WHERE tg.public_status_code_hash = ?1 AND tg.status <> 'CANCELED'`,
  )
    .bind(await sha256Hex(groupCode))
    .first<{
      id: string;
      operation_day_id: string;
      operations_end_at: string | null;
      representative_ticket_id: string | null;
    }>();
  if (!group?.representative_ticket_id) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  if (!group.operations_end_at) {
    return context.json(
      {
        error: {
          code: "PUSH_RETENTION_UNCONFIGURED",
          message: "Web-Push ist erst nach Festlegung des Veranstaltungsendes verfügbar.",
        },
      },
      409,
    );
  }
  const now = new Date();
  const deleteAfter = pushDeleteAfter(
    group.operations_end_at,
    pushRetentionDays(context.env.PUSH_RETENTION_DAYS),
  );
  if (Date.parse(deleteAfter) <= now.getTime()) {
    return context.json(
      {
        error: {
          code: "PUSH_RETENTION_EXPIRED",
          message: "Für diese Veranstaltung werden keine Push-Ziele mehr gespeichert.",
        },
      },
      409,
    );
  }
  await context.env.DB.prepare(
    `INSERT INTO web_push_subscriptions
       (id, operation_day_id, ticket_id, ticket_group_id, target_kind, endpoint, p256dh, auth,
        consented_at, delete_after, status, updated_at, origin)
     VALUES (?1, ?2, ?3, ?4, 'GROUP', ?5, ?6, ?7, ?8, ?9, 'ACTIVE', ?8, ?10)
     ON CONFLICT(endpoint) DO UPDATE SET ticket_id = excluded.ticket_id,
       ticket_group_id = excluded.ticket_group_id, operation_day_id = excluded.operation_day_id,
       target_kind = excluded.target_kind, p256dh = excluded.p256dh, auth = excluded.auth,
       consented_at = excluded.consented_at, delete_after = excluded.delete_after,
       origin = excluded.origin, status = 'ACTIVE', updated_at = excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(),
      group.operation_day_id,
      group.representative_ticket_id,
      group.id,
      body.endpoint,
      body.keys.p256dh,
      body.keys.auth,
      now.toISOString(),
      deleteAfter,
      new URL(context.req.url).origin,
    )
    .run();
  const rotationRows = await context.env.DB.prepare(
    `SELECT DISTINCT rt.rotation_id
       FROM rotation_tickets rt
       JOIN tickets t ON t.id = rt.ticket_id
      WHERE t.ticket_group_id = ?1 AND rt.released_at IS NULL`,
  )
    .bind(group.id)
    .all<{ rotation_id: string }>();
  let preparationQueued = 0;
  for (const rotation of rotationRows.results) {
    preparationQueued += await queueEligiblePreparationNotifications(
      context.env,
      group.operation_day_id,
      rotation.rotation_id,
    );
  }
  return context.json(
    {
      active: true,
      consentedAt: now.toISOString(),
      deleteAfter,
      preparationQueued: preparationQueued > 0,
    },
    201,
  );
});

app.delete("/api/public/tickets/:ticketCode/push-subscriptions", async (context) => {
  const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
  const body = await context.req.json<{ endpoint?: string }>();
  if (!/^[A-Z2-9]{12,32}$/.test(ticketCode) || typeof body.endpoint !== "string") {
    return context.json(
      { error: { code: "INVALID_REQUEST", message: "Abmeldung ist ungültig." } },
      400,
    );
  }
  await context.env.DB.prepare(
    `DELETE FROM web_push_subscriptions
      WHERE endpoint = ?1 AND target_kind = 'TICKET'
        AND ticket_id IN (SELECT id FROM tickets WHERE public_code_hash = ?2)`,
  )
    .bind(body.endpoint, await sha256Hex(ticketCode))
    .run();
  return context.body(null, 204);
});

app.delete("/api/public/groups/:groupCode/push-subscriptions", async (context) => {
  const groupCode = context.req.param("groupCode").trim().toUpperCase();
  const body = await context.req.json<{ endpoint?: string }>();
  if (!/^[A-Z2-9]{12,32}$/.test(groupCode) || typeof body.endpoint !== "string") {
    return context.json(
      { error: { code: "INVALID_REQUEST", message: "Abmeldung ist ungültig." } },
      400,
    );
  }
  await context.env.DB.prepare(
    `DELETE FROM web_push_subscriptions
      WHERE endpoint = ?1 AND target_kind = 'GROUP' AND ticket_group_id IN (
        SELECT id FROM ticket_groups WHERE public_status_code_hash = ?2
      )`,
  )
    .bind(body.endpoint, await sha256Hex(groupCode))
    .run();
  return context.body(null, 204);
});

app.get("/api/public/events/:eventId/board", async (context) => {
  const requestStartedAt = performance.now();
  const eventId = context.req.param("eventId");
  const requestedGateId = context.req.query("gateId")?.trim() || null;
  const event = await loadFidsProjectionEvent(context.env.DB, eventId);
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const selectedGate = requestedGateId
    ? await withGateDisplayFilterFallback((mode) => {
        const displayFilterProjection =
          mode === "current"
            ? "display_filter_json"
            : `'${EMPTY_GATE_DISPLAY_FILTER_JSON}' AS display_filter_json`;
        return context.env.DB.prepare(
          `SELECT id, label, ${displayFilterProjection} FROM gates
            WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
        )
          .bind(requestedGateId, eventId)
          .first<{ id: string; label: string; display_filter_json: string }>();
      })
    : null;
  if (requestedGateId && !selectedGate) {
    return context.json(
      { error: { code: "GATE_NOT_FOUND", message: "Anzeige-Gate nicht gefunden." } },
      404,
    );
  }
  const displayFilter: GateDisplayFilter = selectedGate
    ? gateDisplayFilterSchema.parse(JSON.parse(selectedGate.display_filter_json))
    : { productIds: [], rotationStatuses: [] };
  const boardReadAt = new Date().toISOString();
  const departedVisibilityCutoff = new Date(
    Date.now() - event.departed_visibility_seconds * 1_000,
  ).toISOString();
  const projectionFilter: FidsProjectionFilter = {
    productIds: displayFilter.productIds,
    gateIds: requestedGateId ? [requestedGateId] : [],
    rotationStatuses: displayFilter.rotationStatuses,
  };
  const rows =
    event.emergency_mode === 1
      ? []
      : await loadFidsProjectionRows(context.env.DB, {
          eventId,
          filter: projectionFilter,
          departedVisibilityCutoff,
          now: boardReadAt,
          band: "ALL",
          limit: 20,
          offset: 0,
        });
  const fleet =
    event.emergency_mode === 1 ? [] : await loadFidsProjectionFleet(context.env.DB, eventId);
  const response = context.json({
    eventName: event.name,
    timeZone: event.time_zone,
    selectedGate: selectedGate
      ? { id: selectedGate.id, label: selectedGate.label, displayFilter }
      : null,
    emergencyMode: event.emergency_mode === 1,
    operationalInterrupted: event.operational_interrupted === 1,
    operationalNotice: event.planned_public_note || event.operational_note,
    departedVisibilitySeconds: event.departed_visibility_seconds,
    updatedAt: event.updated_at,
    groups: rows.map((row) => {
      const {
        rowId: _rowId,
        productId: _productId,
        gateId: _gateId,
        bookingGroupLabels: _bookingGroupLabels,
        sharedFlightKey: _sharedFlightKey,
        ...group
      } = mapFidsProjectionRow(row, event, boardReadAt);
      return group;
    }),
    fleet: event.emergency_mode
      ? []
      : fleet.map((aircraft) => ({
          registration: aircraft.registration,
          status: aircraft.operational_state,
          refuelPlanned: aircraft.refuel_planned === 1,
        })),
  });
  response.headers.set(
    "server-timing",
    `public-board;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
  );
  return response;
});

app.all("/api/public/events/:eventId/live", async (context) => {
  const eventId = context.req.param("eventId");
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const response = await stub.fetch(context.req.raw);
  return new Response(response.body, response);
});

app.on("GET", eventRoutes("/live"), async (context) => {
  const actor = await authorizeSession(context.env, context.req.raw);
  if (!actor && context.env.APP_ENV !== "development") {
    return context.json(
      { error: { code: "SESSION_REQUIRED", message: "Anmeldung erforderlich." } },
      401,
    );
  }
  const eventId = context.req.param("eventId");
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const response = await stub.fetch(context.req.raw);
  return new Response(response.body, response);
});

app.on("POST", eventRoutes("/commands"), async (context) => {
  const eventId = context.req.param("eventId");
  const actor = context.get("sessionActor");
  if (!actor && context.env.APP_ENV !== "development") {
    return context.json(
      { error: { code: "SESSION_REQUIRED", message: "Anmeldung erforderlich." } },
      401,
    );
  }
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const target = new URL(context.req.url);
  target.pathname = `/internal/events/${encodeURIComponent(eventId)}/command`;
  if (!actor) {
    const response = await stub.fetch(new Request(target, context.req.raw));
    return new Response(response.body, response);
  }
  const command = (await context.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!command) {
    return context.json(
      { error: { code: "INVALID_COMMAND", message: "Kommando ist ungültig." } },
      400,
    );
  }
  const headers = new Headers(context.req.raw.headers);
  for (const name of [
    "x-device-id",
    "x-device-token",
    "x-operator-account-id",
    "x-operator-login-code",
    "x-operator-session-id",
    "x-operator-role",
    "x-operator-device-id",
  ])
    headers.delete(name);
  headers.set("content-type", "application/json");
  headers.set("x-operator-account-id", actor.accountId);
  headers.set("x-operator-login-code", actor.loginCode);
  headers.set("x-operator-session-id", actor.sessionId);
  headers.set("x-operator-role", actor.role);
  headers.set("x-operator-device-id", actor.deviceId);
  const response = await stub.fetch(
    new Request(target, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...command, deviceId: actor.deviceId }),
    }),
  );
  return new Response(response.body, response);
});

app.notFound((context) =>
  context.json({ error: { code: "NOT_FOUND", message: "API-Route nicht gefunden." } }, 404),
);

app.onError((error, context) => {
  if (error instanceof SyntaxError) {
    return context.json(
      { error: { code: "INVALID_JSON", message: "JSON-Anfrage ist ungültig." } },
      400,
    );
  }
  console.error(
    JSON.stringify({ level: "error", code: "UNHANDLED_API_ERROR", message: error.message }),
  );
  return context.json({ error: { code: "INTERNAL_ERROR", message: "Interner Fehler." } }, 500);
});

export { EventCoordinator };

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const purgedPushSubscriptions = await purgeExpiredPushSubscriptions(env);
    const now = new Date();
    const expiredAnalysisArchives = await expireAnalysisArchives(env, now);
    const builtAnalysisArchives = await processPendingAnalysisArchives(env);
    const nextOperationDate = operationDateInTimeZone(
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
    );
    const upcoming = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM operation_days
        WHERE event_date = ?1 AND status IN ('PREPARATION', 'ACTIVE')`,
    )
      .bind(nextOperationDate)
      .first<{ count: number }>();
    const backupReason = (upcoming?.count ?? 0) > 0 ? "PRE_EVENT" : "DAILY";
    const result = await createPortableBackup(env, now, backupReason);
    console.log(
      JSON.stringify({
        level: "info",
        code: "PORTABLE_BACKUP_CREATED",
        key: result.key,
        checksum: result.checksum,
        reason: backupReason,
        purgedPushSubscriptions,
        expiredAnalysisArchives,
        builtAnalysisArchives,
        timestamp: now.toISOString(),
      }),
    );
  },
};
