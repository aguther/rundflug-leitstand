import { APP_NAME, APP_VERSION, REQUIREMENTS_VERSION } from "@rundflug/config";
import {
  adminDeviceRecoverySchema,
  adminPinVerificationSchema,
  bootstrapRequestSchema,
  cloneEventRequestSchema,
  createOperatorAccountSchema,
  type FactoryResetResponse,
  type FidsPreferences,
  factoryResetRequestSchema,
  forecastHistoryQuerySchema,
  forecastHistorySchema,
  type GateDisplayFilter,
  gateDisplayFilterSchema,
  operationalHistoryQuerySchema,
  operationalHistorySchema,
  operatorLoginRequestSchema,
  ticketSearchRequestSchema,
  updateOperatorAccountSchema,
} from "@rundflug/contracts";
import {
  assessForecastFreshness,
  assessRemainingCapacity,
  deriveResourceGroupCapacity,
  estimateDuration,
  forecastQueueWindows,
  formatBookingGroupLabel,
  formatFlightGroupLabel,
} from "@rundflug/domain";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  assertRole,
  authorizeSession,
  clearedSessionCookie,
  nextLoginCode,
  type OperatorRole,
  type SessionActor,
  sessionCookie,
  sessionTimes,
} from "./auth";
import { createPortableBackup, operationDateInTimeZone } from "./backup";
import { hashPin, randomToken, sha256Hex, verifyCredential, verifyPin } from "./crypto";
import { runD1ReadsSequentially } from "./d1-read-scheduler";
import { dailyReportCsv, dailyReportPdfLines, loadDailyReport } from "./daily-report";
import { EventCoordinator } from "./event-coordinator";
import { eventDeletionStatements } from "./event-deletion";
import { eventLogoExtension, validateEventLogo } from "./event-logo";
import {
  clearFactoryResetCoordinators,
  factoryResetRequestHash,
  factoryResetStatements,
  finishR2Cleanup,
} from "./factory-reset";
import { mayAccessFids } from "./fids-authorization";
import { buildForecastHistoryStatement } from "./forecast-history";
import {
  EMPTY_GATE_DISPLAY_FILTER_JSON,
  withGateDisplayFilterFallback,
} from "./gate-display-filter-storage";
import { buildOperationalHistoryStatement } from "./operational-history";
import {
  allowAdminDeviceRecoveryAttempt,
  allowLoginAttempt,
  allowUnknownTicketAttempt,
} from "./public-access";
import { createCsv, createTextPdf } from "./report";
import { rowToSnapshot } from "./snapshot";
import { httpsRedirectLocation } from "./transport-security";
import type { Env, StoredEventRow } from "./types";
import {
  isAllowedPushEndpoint,
  purgeExpiredPushSubscriptions,
  pushDeleteAfter,
  pushRetentionDays,
  queueEligiblePreparationNotifications,
} from "./web-push";

const app = new Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>();

function eventRoutes<const Suffix extends string>(
  suffix: Suffix,
): [`/api/control/:eventId${Suffix}`, `/api/events/:eventId${Suffix}`] {
  const controlPath = `/api/control/:eventId${suffix}` as `/api/control/:eventId${Suffix}`;
  const legacyPath = `/api/events/:eventId${suffix}` as `/api/events/:eventId${Suffix}`;
  return [controlPath, legacyPath];
}

interface TicketSearchCursor {
  soldAt: string;
  id: string;
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
  const storedLowerMs = input.predictedBoardingAt
    ? Date.parse(input.predictedBoardingAt)
    : Number.NaN;
  const lowerMs = Number.isFinite(storedLowerMs)
    ? storedLowerMs
    : referenceMs + input.lowerMinutes * 60_000;
  const widthMinutes = Math.max(0, input.upperMinutes - input.lowerMinutes);
  return {
    lowerAt: new Date(lowerMs).toISOString(),
    upperAt: new Date(lowerMs + widthMinutes * 60_000).toISOString(),
  };
}

type PublicStatusInstallTarget = "ticket" | "group";

interface AppInstallProfile {
  manifestHref: string;
  appleTouchIconHref: string;
  title: string;
}

const PUBLIC_STATUS_CODE_PATTERN = /^[A-Z2-9]{12,32}$/;

const INTERNAL_APP_INSTALL_PROFILES = {
  "/kasse": {
    manifestHref: "/manifests/kasse.webmanifest",
    appleTouchIconHref: "/icons/kasse-icon-180.png",
    title: "Kasse · Rundflug-Leitstand",
  },
  "/flight-line": {
    manifestHref: "/manifests/flight-line.webmanifest",
    appleTouchIconHref: "/icons/flight-line-icon-180.png",
    title: "Flight Line · Rundflug-Leitstand",
  },
  "/flight-line/assist": {
    manifestHref: "/manifests/assist.webmanifest",
    appleTouchIconHref: "/icons/assist-icon-180.png",
    title: "Assist · Rundflug-Leitstand",
  },
  "/fids": {
    manifestHref: "/manifests/fids.webmanifest",
    appleTouchIconHref: "/icons/fids-icon-180.png",
    title: "FIDS · Rundflug-Leitstand",
  },
  "/fids/terminal": {
    manifestHref: "/manifests/fids.webmanifest",
    appleTouchIconHref: "/icons/fids-icon-180.png",
    title: "FIDS · Rundflug-Leitstand",
  },
  "/admin": {
    manifestHref: "/manifests/admin.webmanifest",
    appleTouchIconHref: "/icons/admin-icon-180.png",
    title: "Admin · Rundflug-Leitstand",
  },
} satisfies Record<string, AppInstallProfile>;

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function publicStatusInstallTitle(
  db: D1Database,
  target: PublicStatusInstallTarget,
  code: string,
): Promise<string> {
  const codeHash = await sha256Hex(code);
  const row =
    target === "ticket"
      ? await db
          .prepare(
            `SELECT p.code AS product_code, tg.communication_number
               FROM tickets t
               JOIN ticket_groups tg ON tg.id = t.ticket_group_id
               JOIN products p ON p.id = tg.product_id
              WHERE t.public_code_hash = ?1 AND tg.status <> 'CANCELED'
              LIMIT 1`,
          )
          .bind(codeHash)
          .first<{ product_code: string; communication_number: number }>()
      : await db
          .prepare(
            `SELECT p.code AS product_code, tg.communication_number
               FROM ticket_groups tg
               JOIN products p ON p.id = tg.product_id
              WHERE tg.public_status_code_hash = ?1 AND tg.status <> 'CANCELED'
              LIMIT 1`,
          )
          .bind(codeHash)
          .first<{ product_code: string; communication_number: number }>();
  return row
    ? formatBookingGroupLabel(row.product_code, row.communication_number)
    : target === "group"
      ? "Gruppenstatus"
      : "Ticketstatus";
}

async function installableAppShellResponse(
  env: Env,
  request: Request,
  profile: AppInstallProfile,
): Promise<Response> {
  const assetResponse = await env.ASSETS.fetch(request);
  if (!assetResponse.headers.get("content-type")?.includes("text/html")) return assetResponse;

  const headers = new Headers(assetResponse.headers);
  headers.set("cache-control", "private, no-store");
  const htmlResponse = new Response(assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
  const appleTitle = profile.title.split(" · ", 1)[0] ?? profile.title;
  const headMetadata = [
    `<link rel="manifest" href="${escapeHtmlAttribute(profile.manifestHref)}">`,
    `<link rel="apple-touch-icon" href="${escapeHtmlAttribute(profile.appleTouchIconHref)}">`,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtmlAttribute(appleTitle)}">`,
    '<meta name="apple-mobile-web-app-capable" content="yes">',
  ].join("");
  return new HTMLRewriter()
    .on('link[rel="manifest"]', {
      element(element) {
        element.remove();
      },
    })
    .on('link[rel="apple-touch-icon"]', {
      element(element) {
        element.remove();
      },
    })
    .on('meta[name="apple-mobile-web-app-title"]', {
      element(element) {
        element.remove();
      },
    })
    .on('meta[name="apple-mobile-web-app-capable"]', {
      element(element) {
        element.remove();
      },
    })
    .on("title", {
      element(element) {
        element.setInnerContent(profile.title);
      },
    })
    .on("head", {
      element(element) {
        element.append(headMetadata, { html: true });
      },
    })
    .transform(htmlResponse);
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
  role: string;
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
    .first<{ role: string; credential_hash: string | null }>();
  if (!device || !(await verifyCredential(token ?? null, device.credential_hash))) return null;
  await env.DB.prepare("UPDATE paired_devices SET last_seen_at = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), deviceId)
    .run();
  return { id: deviceId, role: device.role, accountId: null, loginCode: null };
}

function eventCoordinatorNamespace(env: Env): DurableObjectNamespace {
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

for (const protectedPrefix of ["/api/control/*", "/api/events/*"] as const) {
  app.use(protectedPrefix, async (context, next) => {
    if (context.req.path.endsWith("/fids/preferences")) {
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
    architecture: "Cloudflare Worker + Static Assets + D1 + Durable Object + R2",
    dataJurisdiction: context.env.DATA_JURISDICTION,
    productionReady: false,
  }),
);

app.get("/api/setup/status", async (context) => {
  const state = await context.env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM app_bootstrap) AS completed,
      (SELECT COUNT(*) FROM operation_days) AS events,
      (SELECT COUNT(*) FROM operator_accounts WHERE role = 'ADMIN' AND active = 1) AS admins`,
  ).first<{ completed: number; events: number; admins: number }>();
  return context.json({
    setupRequired:
      (state?.completed ?? 0) === 0 && (state?.events ?? 0) === 0 && (state?.admins ?? 0) === 0,
    setupConfigured: Boolean(context.env.BOOTSTRAP_TOKEN),
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
  if (!context.env.BOOTSTRAP_TOKEN) {
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
  const state = await context.env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM app_bootstrap) AS completed,
      (SELECT COUNT(*) FROM operation_days) AS events,
      (SELECT COUNT(*) FROM operator_accounts WHERE role = 'ADMIN' AND active = 1) AS admins`,
  ).first<{ completed: number; events: number; admins: number }>();
  if ((state?.completed ?? 0) > 0 || (state?.events ?? 0) > 0 || (state?.admins ?? 0) > 0) {
    return context.json(
      { error: { code: "SETUP_ALREADY_COMPLETED", message: "Ersteinrichtung ist abgeschlossen." } },
      409,
    );
  }
  const setupTokenHash = await sha256Hex(context.env.BOOTSTRAP_TOKEN);
  if (!(await verifyCredential(parsed.data.setupCode, setupTokenHash))) {
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
    await context.env.DB.batch([
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
    ]);
  } catch {
    return context.json(
      { error: { code: "SETUP_ALREADY_COMPLETED", message: "Ersteinrichtung ist abgeschlossen." } },
      409,
    );
  }
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
      WHERE active = 1 ORDER BY role, login_code`,
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
       FROM operator_accounts WHERE id = ?1`,
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
    `SELECT id, login_code, role, active FROM operator_accounts ORDER BY role, login_code`,
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
      WHERE id = ?4`,
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
    (!actor && !(await verifyCredential(parsed.data.adminPin, context.env.ADMIN_PIN_HASH)))
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
  if (
    !operationDay ||
    (device && device.role !== "ADMIN") ||
    !(await verifyCredential(parsed.data.adminPin, context.env.ADMIN_PIN_HASH))
  ) {
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
    `SELECT request_hash, r2_cleanup_pending, response_json
       FROM system_reset_receipts WHERE command_id = ?1`,
  )
    .bind(input.commandId)
    .first<{
      request_hash: string;
      r2_cleanup_pending: number;
      response_json: string;
    }>();
  if (prior) {
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
    return context.json(response);
  }

  const authorized = await authorizeDevice(context.env, input.eventId, context.req.raw);
  const actor = await authorizeSession(context.env, context.req.raw);
  if (
    authorized?.role !== "ADMIN" ||
    (!actor && !(await verifyCredential(input.adminPin, context.env.ADMIN_PIN_HASH)))
  ) {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }

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
        new Date().toISOString(),
        input.deleteAllBackups,
        response,
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
      return context.json(await finishR2Cleanup(context.env, input.commandId, response));
    } catch {
      return context.json(response, 202);
    }
  }
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
  const [gates, groups, products, pilots, memberships] = await Promise.all([
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
          (id, operation_day_id, label, gate_type, active, sort_order, display_filter_json,
           created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
      ).bind(
        gateIds.get(String(row.id)),
        input.eventId,
        row.label,
        row.gate_type,
        row.active,
        row.sort_order,
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
         reference_capacity, planned_rotation_minutes, compatible_aircraft_types_json)
       VALUES (?1, ?2, ?3, ?4, 'ACTIVE', 0, ?5, ?5, ?6, ?7, ?8, ?9)`,
      ).bind(
        groupIds.get(String(row.id)),
        input.eventId,
        row.name,
        row.short_code,
        now,
        row.gate_id ? gateIds.get(String(row.gate_id)) : null,
        row.reference_capacity,
        row.planned_rotation_minutes,
        row.compatible_aircraft_types_json,
      ),
    ),
    ...(keepMasterData ? products.results : []).map((row) =>
      context.env.DB.prepare(
        `INSERT INTO products
        (id, operation_day_id, resource_group_id, name, price_cents, sale_enabled, created_at,
          updated_at, sale_closes_at, capacity_warning_threshold, capacity_critical_threshold,
          code, public_description, child_companion_required, sort_order, weight_classes_json, gate_id,
          reference_capacity, reference_duration_minutes, promised_flight_minutes)
        VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6, NULL, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
          ?15, ?16, ?17)`,
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
  const device = await authorizeDevice(context.env, sourceEventId, context.req.raw);
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const input = (await context.req.json().catch(() => null)) as {
    confirmation?: string;
    reason?: string;
  } | null;
  if (input?.confirmation !== eventId || (input.reason?.trim().length ?? 0) < 3) {
    return context.json(
      {
        error: {
          code: "EVENT_DELETE_CONFIRMATION_INVALID",
          message: "Veranstaltungs-ID und Begründung müssen bestätigt werden.",
        },
      },
      400,
    );
  }
  const event = await context.env.DB.prepare(
    "SELECT id, logo_object_key FROM operation_days WHERE id = ?1",
  )
    .bind(eventId)
    .first<{ id: string; logo_object_key: string | null }>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const count = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM operation_days").first<{
    count: number;
  }>();
  const lastEvent = (count?.count ?? 0) <= 1;
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
  const statements = eventDeletionStatements(context.env, eventId);
  if (lastEvent) {
    statements.push(
      context.env.DB.prepare("DELETE FROM operator_sessions"),
      context.env.DB.prepare("DELETE FROM operator_accounts"),
      context.env.DB.prepare("DELETE FROM app_bootstrap"),
    );
  }
  await context.env.DB.batch(statements);
  if (event.logo_object_key) await context.env.BACKUPS.delete(event.logo_object_key);
  return context.json({ deleted: true, eventId, setupRequired: lastEvent });
});

app.put("/api/admin/events/:eventId/logo", async (context) => {
  const eventId = context.req.param("eventId");
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
  const event = await context.env.DB.prepare(
    "SELECT version, logo_object_key FROM operation_days WHERE id = ?1",
  )
    .bind(eventId)
    .first<{ version: number; logo_object_key: string | null }>();
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
  const bytes = new Uint8Array(await context.req.raw.arrayBuffer());
  let mediaType: ReturnType<typeof validateEventLogo>;
  try {
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
    customMetadata: { eventId },
  });
  const response = { logoUrl: `/api/public/events/${encodeURIComponent(eventId)}/logo` };
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE operation_days
            SET logo_object_key = ?1, logo_media_type = ?2, logo_updated_at = ?3,
                version = version + 1, updated_at = ?3
          WHERE id = ?4 AND version = ?5`,
      ).bind(objectKey, mediaType, now, eventId, expectedVersion),
      context.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'EVENT_LOGO_CHANGED', ?3, ?4, 'OPERATION_DAY', ?2, ?5, ?6)`,
      ).bind(
        crypto.randomUUID(),
        eventId,
        now,
        device.id,
        expectedVersion + 1,
        JSON.stringify({ mediaType }),
      ),
      context.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         VALUES (?1, ?2, ?3, 'SET_EVENT_LOGO', ?4, ?5)`,
      ).bind(commandId, eventId, device.id, now, JSON.stringify(response)),
      context.env.DB.prepare(
        "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
      ).bind(crypto.randomUUID(), eventId, JSON.stringify(response), now),
    ]);
  } catch (cause) {
    await context.env.BACKUPS.delete(objectKey);
    throw cause;
  }
  if (event.logo_object_key) await context.env.BACKUPS.delete(event.logo_object_key);
  return context.json(response);
});

app.delete("/api/admin/events/:eventId/logo", async (context) => {
  const eventId = context.req.param("eventId");
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
  const event = await context.env.DB.prepare(
    "SELECT version, logo_object_key FROM operation_days WHERE id = ?1",
  )
    .bind(eventId)
    .first<{ version: number; logo_object_key: string | null }>();
  if (!event) return context.body(null, 404);
  if (event.version !== expectedVersion) {
    return context.json(
      {
        error: { code: "STALE_VERSION", message: "Veranstaltung wurde zwischenzeitlich geändert." },
      },
      409,
    );
  }
  const now = new Date().toISOString();
  const response = { removed: true };
  await context.env.DB.batch([
    context.env.DB.prepare(
      `UPDATE operation_days SET logo_object_key = NULL, logo_media_type = NULL,
          logo_updated_at = ?1, version = version + 1, updated_at = ?1
        WHERE id = ?2 AND version = ?3`,
    ).bind(now, eventId, expectedVersion),
    context.env.DB.prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json)
       VALUES (?1, ?2, 'EVENT_LOGO_REMOVED', ?3, ?4, 'OPERATION_DAY', ?2, ?5, '{}')`,
    ).bind(crypto.randomUUID(), eventId, now, device.id, event.version + 1),
    context.env.DB.prepare(
      `INSERT INTO idempotency_receipts
        (command_id, operation_day_id, device_id, command_type, received_at, response_json)
       VALUES (?1, ?2, ?3, 'REMOVE_EVENT_LOGO', ?4, ?5)`,
    ).bind(commandId, eventId, device.id, now, JSON.stringify(response)),
    context.env.DB.prepare(
      "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
    ).bind(crypto.randomUUID(), eventId, JSON.stringify(response), now),
  ]);
  if (event.logo_object_key) await context.env.BACKUPS.delete(event.logo_object_key);
  return context.body(null, 204);
});

app.get("/api/public/events/:eventId/logo", async (context) => {
  const eventId = context.req.param("eventId");
  const event = await context.env.DB.prepare(
    "SELECT logo_object_key, logo_media_type FROM operation_days WHERE id = ?1",
  )
    .bind(eventId)
    .first<{ logo_object_key: string | null; logo_media_type: string | null }>();
  if (!event?.logo_object_key || !event.logo_media_type) return context.body(null, 404);
  const object = await context.env.BACKUPS.get(event.logo_object_key);
  if (!object) return context.body(null, 404);
  return new Response(object.body, {
    headers: {
      "content-type": event.logo_media_type,
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    },
  });
});

app.on("GET", eventRoutes("/snapshot"), async (context) => {
  const row = await context.env.DB.prepare(
    `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
            emergency_mode, operational_interrupted, version,
            operational_note, operations_end_at, sale_opens_at, no_show_after_minutes,
            max_ticket_deferrals,
            notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
            automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
            precall_min_quality, precall_gate_cooldown_minutes,
            heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
            planned_buffer_minutes, updated_at
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
  const stored = await context.env.DB.prepare(
    `SELECT visible_rows, layout, theme, version
       FROM fids_preferences
      WHERE operator_account_id = ?1 AND operation_day_id = ?2`,
  )
    .bind(actor.accountId, eventId)
    .first<{
      visible_rows: number;
      layout: FidsPreferences["layout"];
      theme: FidsPreferences["theme"];
      version: number;
    }>();
  return context.json({
    visibleRows: stored?.visible_rows ?? 8,
    layout: stored?.layout ?? "SINGLE",
    theme: stored?.theme ?? "SYSTEM",
    version: stored?.version ?? 0,
  } satisfies FidsPreferences);
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
            operational_note, operations_end_at, sale_opens_at, no_show_after_minutes,
            max_ticket_deferrals,
            notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
            automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
            precall_min_quality, precall_gate_cooldown_minutes,
            heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
            planned_buffer_minutes, updated_at FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<StoredEventRow>();
  if (!eventRow) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }

  const [
    products,
    rotations,
    queueGroupRows,
    durationRows,
    aircraftRows,
    fleetRows,
    pilotRows,
    gatesRows,
    resourceGroupRows,
    metricsRow,
  ] = await runD1ReadsSequentially([
    () =>
      context.env.DB.prepare(
        `SELECT p.id, p.code, p.name, p.public_description, p.resource_group_id, rg.name AS resource_group_name,
              rg.status AS resource_group_status, rg.operational_note AS resource_group_operational_note,
              p.price_cents, p.sale_enabled, p.reference_capacity, p.reference_duration_minutes,
              p.promised_flight_minutes,
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
        ORDER BY p.sort_order, p.name`,
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
          queued_tickets: number;
          resource_group_open_tickets: number;
          sale_closes_at: string | null;
          capacity_warning_threshold: number;
          capacity_critical_threshold: number;
        }>(),
    () =>
      context.env.DB.prepare(
        `SELECT r.id, r.version, r.flight_group_id, fg.resource_group_id,
              rotation_rg.short_code AS resource_group_short_code, fg.communication_number,
              COALESCE(fg.queue_position, fg.communication_number) AS queue_position,
              r.status, r.aircraft_id, r.usable_capacity, fg.precalled_at,
              COALESCE(r.gate_id, MIN(p.gate_id), '') AS gate_id,
              COALESCE(MAX(rotation_gate.label), MIN(product_gate.label), '') AS gate_label,
              r.operational_note,
              r.called_at, r.departed_at, r.landed_at, r.completed_at,
              r.planned_boarding_at, r.planned_departure_at, r.planned_landing_at,
              r.planned_completion_at, r.predicted_boarding_at, r.predicted_departure_at,
              r.predicted_landing_at, r.predicted_completion_at, r.prediction_quality,
              r.prediction_lower_minutes, r.prediction_upper_minutes, r.prediction_updated_at,
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
                  'presentCount', grouped_tickets.present_count
                ))
                  FROM (
                    SELECT grouped_ticket.ticket_group_id,
                           grouped_group.communication_number,
                           grouped_group.sold_at,
                           COUNT(*) AS ticket_count,
                           SUM(CASE WHEN grouped_ticket.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END)
                             AS present_count
                      FROM rotation_tickets grouped_rt
                      JOIN tickets grouped_ticket ON grouped_ticket.id = grouped_rt.ticket_id
                      JOIN ticket_groups grouped_group ON grouped_group.id = grouped_ticket.ticket_group_id
                     WHERE grouped_rt.rotation_id = r.id AND grouped_rt.released_at IS NULL
                     GROUP BY grouped_ticket.ticket_group_id, grouped_group.communication_number,
                              grouped_group.sold_at
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
                     segment_group.queue_position, segment_group.communication_number
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
                tg.recalled_at, tg.recall_count, p.id AS product_id, p.code AS product_code,
                p.name AS product_name, p.resource_group_id, p.gate_id,
                COUNT(t.id) AS ticket_count,
                SUM(CASE WHEN t.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS present_count,
                next_segment.ticket_count AS next_segment_ticket_count,
                next_segment.present_count AS next_segment_present_count,
                next_segment.segment_index,
                next_segment.segment_count
           FROM ticket_groups tg
           JOIN products p ON p.id = tg.product_id
           JOIN tickets t ON t.ticket_group_id = tg.id
           JOIN next_draft_segments next_segment ON next_segment.ticket_group_id = tg.id
          WHERE tg.operation_day_id = ?1 AND tg.status IN ('QUEUED', 'PRESENT', 'MISSING')
          GROUP BY tg.id, p.id, next_segment.ticket_count, next_segment.present_count,
                   next_segment.segment_index, next_segment.segment_count
          ORDER BY tg.queue_sequence`,
      )
        .bind(eventId)
        .all<{
          id: string;
          communication_number: number;
          queue_sequence: number;
          status: string;
          recalled_at: string | null;
          recall_count: number;
          product_id: string;
          product_code: string;
          product_name: string;
          resource_group_id: string;
          gate_id: string;
          ticket_count: number;
          present_count: number;
          next_segment_ticket_count: number;
          next_segment_present_count: number;
          segment_index: number;
          segment_count: number;
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
        `SELECT m.resource_group_id, a.passenger_seats, a.refuel_planned FROM aircraft a
         JOIN resource_group_memberships m ON m.aircraft_id = a.id
        WHERE m.operation_day_id = ?1 AND m.active_until IS NULL
          AND a.operational_state NOT IN ('INACTIVE', 'PAUSED', 'REFUELING')`,
      )
        .bind(eventId)
        .all<{ resource_group_id: string; passenger_seats: number; refuel_planned: number }>(),
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
          `SELECT g.id, g.label, g.gate_type, g.active, g.sort_order, ${displayFilterProjection},
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
            display_filter_json: string;
            assigned_resource_group_ids_json: string;
          }>();
      }),
    () =>
      context.env.DB.prepare(
        `SELECT rg.id, rg.version, rg.name, rg.short_code, rg.status, rg.gate_id, g.label AS gate_label,
              rg.reference_capacity, rg.planned_rotation_minutes,
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
          gate_id: string;
          gate_label: string;
          reference_capacity: number;
          planned_rotation_minutes: number;
          compatible_aircraft_types_json: string;
          automatic_precall_enabled: number;
          aircraft_ids_json: string;
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
  const operationsEnd = eventRow.operations_end_at ? Date.parse(eventRow.operations_end_at) : 0;
  const remainingOperatingMinutes = Math.max(0, (operationsEnd - Date.now()) / 60_000);

  const response = context.json({
    currentDeviceRole: device.role,
    event: rowToSnapshot(eventRow),
    products: products.results.map((product) => {
      const allGroupAircraftSeats = aircraftRows.results
        .filter((aircraft) => aircraft.resource_group_id === product.resource_group_id)
        .map((aircraft) => aircraft.passenger_seats);
      const groupAircraftSeats = allGroupAircraftSeats.slice(0, activePilotCount);
      const effectiveReferenceCapacity = Math.max(
        1,
        deriveResourceGroupCapacity(allGroupAircraftSeats),
      );
      const reservedRefuelSeats = aircraftRows.results
        .filter(
          (aircraft) =>
            aircraft.resource_group_id === product.resource_group_id &&
            aircraft.refuel_planned === 1,
        )
        .reduce((sum, aircraft) => sum + aircraft.passenger_seats, 0);
      const activeAircraft = groupAircraftSeats.length;
      const queueSequence = Math.max(
        1,
        Math.ceil(product.queued_tickets / product.reference_capacity),
      );
      const duration = estimateDuration({
        referenceMinutes:
          product.reference_duration_minutes +
          (eventRow.planned_boarding_minutes ?? 8) +
          (eventRow.planned_deboarding_minutes ?? 5) +
          (eventRow.planned_buffer_minutes ?? 3),
        actualDurationsMinutes: actualDurations,
        interrupted:
          product.resource_group_status !== "ACTIVE" ||
          eventRow.emergency_mode === 1 ||
          eventRow.operational_interrupted === 1,
        activeCapacity: activeAircraft,
      });
      const forecast = forecastQueueWindows({ queueSequence, activeAircraft, duration });
      const forecastReferenceMs = Date.now();
      const nextBoardingWindowLowerAt =
        forecast.quality === "UNCERTAIN"
          ? null
          : new Date(forecastReferenceMs + forecast.lowerMinutes * 60_000).toISOString();
      const nextBoardingWindowUpperAt =
        forecast.quality === "UNCERTAIN"
          ? null
          : new Date(forecastReferenceMs + forecast.upperMinutes * 60_000).toISOString();
      const capacity = assessRemainingCapacity({
        remainingOperatingMinutes,
        expectedRotationMinutes: duration.expectedMinutes,
        activeAircraftSeats: eventRow.operational_interrupted === 1 ? [] : groupAircraftSeats,
        openTickets: product.resource_group_open_tickets,
        reservedSeats: reservedRefuelSeats,
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
    rotations: rotations.results.map((rotation, index) => {
      const activeAircraft = aircraftRows.results.filter(
        (aircraft) => aircraft.resource_group_id === rotation.resource_group_id,
      ).length;
      const effectiveActiveCapacity = Math.min(activeAircraft, activePilotCount);
      const suggestedAircraft = fleetRows.results.find(
        (aircraft) => aircraft.id === rotation.suggested_aircraft_id,
      );
      const rememberedPilot = pilotRows.results.find(
        (pilot) =>
          pilot.id === suggestedAircraft?.current_pilot_id &&
          pilot.active === 1 &&
          pilot.paused === 0 &&
          pilot.current_rotation_id === null,
      );
      const forecastFreshness = assessForecastFreshness({
        predictionQuality: rotation.prediction_quality,
        predictionUpdatedAt: rotation.prediction_updated_at,
        now: forecastReadAt,
      });
      const resourceGroupStatus = products.results.find(
        (product) => product.resource_group_id === rotation.resource_group_id,
      )?.resource_group_status;
      const effectivePredictionQuality =
        eventRow.emergency_mode === 1 ||
        eventRow.operational_interrupted === 1 ||
        resourceGroupStatus !== "ACTIVE" ||
        effectiveActiveCapacity === 0
          ? "UNCERTAIN"
          : forecastFreshness.quality;
      const fallbackWindow = forecastQueueWindows({
        queueSequence: index + 1,
        activeAircraft: effectiveActiveCapacity,
        duration: estimateDuration({
          referenceMinutes:
            rotation.reference_duration_minutes +
            (eventRow.planned_boarding_minutes ?? 8) +
            (eventRow.planned_deboarding_minutes ?? 5) +
            (eventRow.planned_buffer_minutes ?? 3),
          actualDurationsMinutes: actualDurations,
          interrupted: eventRow.emergency_mode === 1 || eventRow.operational_interrupted === 1,
          activeCapacity: effectiveActiveCapacity,
        }),
      });
      const predictedLowerMinutes =
        rotation.prediction_lower_minutes ?? fallbackWindow.lowerMinutes;
      const predictedUpperMinutes =
        rotation.prediction_upper_minutes ?? fallbackWindow.upperMinutes;
      const boardingWindow = predictedBoardingWindow({
        status: rotation.status,
        quality: effectivePredictionQuality,
        predictedBoardingAt: rotation.predicted_boarding_at,
        lowerMinutes: predictedLowerMinutes,
        upperMinutes: predictedUpperMinutes,
        referenceAt: forecastReadAt,
      });
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
        suggestedPilotId: rememberedPilot?.id ?? rotation.suggested_pilot_id,
        suggestedPilotOperationalCode:
          rememberedPilot?.operational_code ?? rotation.suggested_pilot_operational_code,
        suggestedAircraftId: rotation.suggested_aircraft_id,
        suggestedAircraftRegistration: rotation.suggested_aircraft_registration,
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
        calledAt: rotation.called_at,
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
      recalledAt: group.recalled_at,
      recallCount: group.recall_count,
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
    gates: gatesRows.results.map((gate) => ({
      id: gate.id,
      label: gate.label,
      gateType: gate.gate_type,
      active: gate.active === 1,
      sortOrder: gate.sort_order,
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
        gateId: group.gate_id,
        gateLabel: group.gate_label,
        referenceCapacity: effectiveReferenceCapacity,
        plannedRotationMinutes: group.planned_rotation_minutes,
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
    conditions.push(
      request.status === "CANCELED" ? "tg.status = 'CANCELED'" : "tg.status <> 'CANCELED'",
    );
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

app.get("/api/public/pwa-manifest/:target/:code", async (context) => {
  const target = context.req.param("target").trim().toLowerCase();
  const code = context.req.param("code").trim().toUpperCase();
  if ((target !== "ticket" && target !== "group") || !PUBLIC_STATUS_CODE_PATTERN.test(code)) {
    return context.json(
      { error: { code: "PUBLIC_TARGET_NOT_FOUND", message: "Statusseite nicht gefunden." } },
      404,
    );
  }
  const targetPath = target === "group" ? `/gruppe/${code}` : `/ticket/${code}`;
  const installTitle = await publicStatusInstallTitle(context.env.DB, target, code);
  return new Response(
    JSON.stringify({
      id: targetPath,
      start_url: targetPath,
      scope: "/",
      name: installTitle,
      short_name: installTitle,
      description: "Aktueller öffentlicher Rundflug-Status",
      lang: "de",
      display: "standalone",
      background_color: "#f4f7fb",
      theme_color: "#ffffff",
      icons: [
        {
          src: "/icons/ticket-icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/ticket-icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/ticket-icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    }),
    {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/manifest+json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    },
  );
});

for (const [path, profile] of Object.entries(INTERNAL_APP_INSTALL_PROFILES)) {
  app.get(path, (context) => installableAppShellResponse(context.env, context.req.raw, profile));
}

for (const target of ["ticket", "group"] as const) {
  const route = target === "group" ? "/gruppe/:code" : "/ticket/:code";
  app.get(route, async (context) => {
    const code = context.req.param("code").trim().toUpperCase();
    if (!PUBLIC_STATUS_CODE_PATTERN.test(code)) {
      return context.env.ASSETS.fetch(context.req.raw);
    }
    const installTitle = await publicStatusInstallTitle(context.env.DB, target, code);
    return installableAppShellResponse(context.env, context.req.raw, {
      manifestHref: `/api/public/pwa-manifest/${target}/${code}`,
      appleTouchIconHref: "/icons/ticket-icon-180.png",
      title: `${installTitle} · Rundflug`,
    });
  });
}

app.get("/api/public/tickets/:ticketCode", async (context) => {
  const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
  if (!/^[A-Z2-9]{12,32}$/.test(ticketCode)) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  const ticketHash = await sha256Hex(ticketCode);
  const row = await context.env.DB.prepare(
    `SELECT p.name AS product_name, p.code AS product_code, p.public_description,
            g.label AS gate_label,
            COALESCE(tg.communication_number, fg.communication_number) AS communication_number,
            fg.precalled_at, r.status, tg.operation_day_id,
            COALESCE(fg.queue_position, tg.queue_sequence) AS queue_sequence,
            t.attendance_status,
            r.predicted_boarding_at, r.prediction_quality,
            r.prediction_lower_minutes, r.prediction_upper_minutes,
            r.prediction_updated_at,
            od.name AS event_name, od.time_zone,
            od.operational_note AS event_operational_note, od.operational_interrupted,
            od.emergency_mode, od.notification_lead_minutes,
            rg.status AS resource_group_status,
            rg.operational_note AS resource_group_operational_note, od.updated_at
       FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN products p ON p.id = tg.product_id
       JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
       JOIN rotations r ON r.id = rt.rotation_id
       JOIN gates g ON g.id = COALESCE(r.gate_id, p.gate_id)
       JOIN flight_groups fg ON fg.id = r.flight_group_id
       JOIN resource_groups rg ON rg.id = fg.resource_group_id
       JOIN operation_days od ON od.id = tg.operation_day_id
      WHERE t.public_code_hash = ?1`,
  )
    .bind(ticketHash)
    .first<{
      product_name: string;
      product_code: string;
      public_description: string;
      gate_label: string;
      communication_number: number;
      precalled_at: string | null;
      status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      operation_day_id: string;
      queue_sequence: number;
      attendance_status: "NOT_CHECKED_IN" | "CHECKED_IN";
      predicted_boarding_at: string | null;
      prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
      prediction_lower_minutes: number | null;
      prediction_upper_minutes: number | null;
      prediction_updated_at: string | null;
      updated_at: string;
      event_name: string;
      time_zone: string;
      event_operational_note: string;
      resource_group_operational_note: string;
      operational_interrupted: number;
      emergency_mode: number;
      notification_lead_minutes: number;
      resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
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
    row.resource_group_status !== "ACTIVE"
      ? "UNCERTAIN"
      : forecastFreshness.quality;
  const prepare =
    row.status === "DRAFT" &&
    row.resource_group_status === "ACTIVE" &&
    row.operational_interrupted === 0 &&
    effectivePredictionQuality !== "UNCERTAIN" &&
    row.prediction_upper_minutes !== null &&
    row.prediction_upper_minutes <= row.notification_lead_minutes;
  const publicState = {
    DRAFT: row.precalled_at ? "COME_TO_FLIGHT_LINE" : prepare ? "PREPARE" : "WAITING",
    CALLED: row.attendance_status === "CHECKED_IN" ? "BOARDING" : "COME_TO_FLIGHT_LINE",
    IN_FLIGHT: "IN_FLIGHT",
    LANDED: "LANDED",
    COMPLETED: "COMPLETED",
  } as const;
  const message = {
    DRAFT: row.precalled_at
      ? "Bitte jetzt zum Gate kommen."
      : prepare
        ? "Ihr Aufruf steht bevor. Bitte bereithalten."
        : "Bitte Status regelmäßig prüfen.",
    CALLED:
      row.attendance_status === "CHECKED_IN"
        ? "Bitte am Gate zum Einstieg bereithalten."
        : "Bitte jetzt zum Gate kommen.",
    IN_FLIGHT: "Ihr Rundflug ist gestartet.",
    LANDED: "Ihr Rundflug ist gelandet.",
    COMPLETED: "Ihr Rundflug ist abgeschlossen.",
  } as const;
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
  return context.json({
    eventId: row.operation_day_id,
    eventName: row.event_name,
    productName: row.product_name,
    productCode: row.product_code,
    publicDescription: row.public_description,
    gateLabel: row.gate_label,
    communicationNumber: row.communication_number,
    status:
      row.emergency_mode === 1 ||
      row.operational_interrupted === 1 ||
      row.resource_group_status !== "ACTIVE"
        ? "SERVICE_PAUSED"
        : publicState[row.status],
    queuePosition: row.emergency_mode === 0 && row.status === "DRAFT" ? row.queue_sequence : null,
    waitLowerMinutes:
      row.emergency_mode === 0 &&
      row.resource_group_status === "ACTIVE" &&
      row.status === "DRAFT" &&
      row.operational_interrupted === 0 &&
      effectivePredictionQuality !== "UNCERTAIN"
        ? lowerMinutes
        : 0,
    waitUpperMinutes:
      row.emergency_mode === 0 &&
      row.resource_group_status === "ACTIVE" &&
      row.status === "DRAFT" &&
      row.operational_interrupted === 0 &&
      effectivePredictionQuality !== "UNCERTAIN"
        ? upperMinutes
        : 0,
    boardingWindowLowerAt: boardingWindow.lowerAt,
    boardingWindowUpperAt: boardingWindow.upperAt,
    timeZone: row.time_zone,
    predictionQuality: effectivePredictionQuality,
    message:
      row.emergency_mode === 1
        ? "Organisatorischer Betrieb pausiert – bitte später erneut prüfen."
        : row.resource_group_status !== "ACTIVE"
          ? "Flugbetrieb für dieses Produkt pausiert – bitte Status erneut prüfen."
          : row.operational_interrupted === 1
            ? "Flugbetrieb unterbrochen – bitte Status erneut prüfen."
            : forecastFreshness.reason === "STALE_PREDICTION"
              ? "Prognose wird aktualisiert – bitte Status erneut prüfen."
              : message[row.status],
    operationalNotice: row.resource_group_operational_note || row.event_operational_note,
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
            od.name AS event_name, od.time_zone, od.operational_note AS event_operational_note,
            od.operational_interrupted, od.emergency_mode, od.notification_lead_minutes,
            od.updated_at, rg.status AS resource_group_status,
            rg.operational_note AS resource_group_operational_note,
            (SELECT COUNT(*) FROM tickets t WHERE t.ticket_group_id = tg.id) AS group_size
       FROM ticket_groups tg
       JOIN products p ON p.id = tg.product_id
       JOIN resource_groups rg ON rg.id = p.resource_group_id
       JOIN operation_days od ON od.id = tg.operation_day_id
      WHERE tg.public_status_code_hash = ?1 AND tg.status <> 'CANCELED'`,
  )
    .bind(await sha256Hex(groupCode))
    .first<{
      id: string;
      communication_number: number;
      operation_day_id: string;
      product_name: string;
      product_code: string;
      public_description: string;
      event_name: string;
      time_zone: string;
      event_operational_note: string;
      operational_interrupted: number;
      emergency_mode: number;
      notification_lead_minutes: number;
      updated_at: string;
      resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
      resource_group_operational_note: string;
      group_size: number;
    }>();
  if (!group) {
    return unknownTicketResponse(context.env, context.req.raw);
  }

  const rotations = await context.env.DB.prepare(
    `SELECT r.id, r.status, r.predicted_boarding_at, r.prediction_quality,
            r.prediction_lower_minutes, r.prediction_upper_minutes, r.prediction_updated_at,
            fg.precalled_at, COALESCE(fg.queue_position, fg.communication_number) AS queue_position,
            g.label AS gate_label, COUNT(t.id) AS passenger_count,
            SUM(CASE WHEN t.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS present_count
       FROM rotation_tickets rt
       JOIN tickets t ON t.id = rt.ticket_id
       JOIN rotations r ON r.id = rt.rotation_id
       JOIN flight_groups fg ON fg.id = r.flight_group_id
       JOIN ticket_groups part_tg ON part_tg.id = t.ticket_group_id
       JOIN products part_product ON part_product.id = part_tg.product_id
       JOIN gates g ON g.id = COALESCE(r.gate_id, part_product.gate_id)
      WHERE t.ticket_group_id = ?1 AND rt.released_at IS NULL AND r.status <> 'CANCELED'
      GROUP BY r.id
      ORDER BY COALESCE(fg.queue_position, fg.communication_number), r.created_at, r.id`,
  )
    .bind(group.id)
    .all<{
      id: string;
      status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      predicted_boarding_at: string | null;
      prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
      prediction_lower_minutes: number | null;
      prediction_upper_minutes: number | null;
      prediction_updated_at: string | null;
      precalled_at: string | null;
      queue_position: number;
      gate_label: string;
      passenger_count: number;
      present_count: number;
    }>();
  if (rotations.results.length === 0) {
    return unknownTicketResponse(context.env, context.req.raw);
  }

  const readAt = new Date().toISOString();
  const partCount = rotations.results.length;
  const parts = rotations.results.map((rotation, index) => {
    const freshness = assessForecastFreshness({
      predictionQuality: rotation.prediction_quality,
      predictionUpdatedAt: rotation.prediction_updated_at,
      now: readAt,
    });
    const predictionQuality =
      group.emergency_mode === 1 ||
      group.operational_interrupted === 1 ||
      group.resource_group_status !== "ACTIVE"
        ? "UNCERTAIN"
        : freshness.quality;
    const lowerMinutes =
      rotation.prediction_lower_minutes ?? Math.max(0, (rotation.queue_position - 1) * 20);
    const upperMinutes =
      rotation.prediction_upper_minutes ?? Math.max(lowerMinutes, rotation.queue_position * 30);
    const prepare =
      rotation.status === "DRAFT" &&
      predictionQuality !== "UNCERTAIN" &&
      upperMinutes <= group.notification_lead_minutes;
    const status =
      group.emergency_mode === 1 ||
      group.operational_interrupted === 1 ||
      group.resource_group_status !== "ACTIVE"
        ? ("SERVICE_PAUSED" as const)
        : rotation.status === "DRAFT"
          ? rotation.precalled_at
            ? ("COME_TO_FLIGHT_LINE" as const)
            : prepare
              ? ("PREPARE" as const)
              : ("WAITING" as const)
          : rotation.status === "CALLED"
            ? rotation.present_count === rotation.passenger_count
              ? ("BOARDING" as const)
              : ("COME_TO_FLIGHT_LINE" as const)
            : rotation.status;
    const publicStatus =
      status === "IN_FLIGHT" ||
      status === "LANDED" ||
      status === "COMPLETED" ||
      status === "SERVICE_PAUSED" ||
      status === "WAITING" ||
      status === "PREPARE" ||
      status === "COME_TO_FLIGHT_LINE" ||
      status === "BOARDING"
        ? status
        : "WAITING";
    const boardingWindow = predictedBoardingWindow({
      status: rotation.status,
      quality: predictionQuality,
      predictedBoardingAt: rotation.predicted_boarding_at,
      lowerMinutes,
      upperMinutes,
      referenceAt: readAt,
    });
    const message =
      group.emergency_mode === 1
        ? "Organisatorischer Betrieb pausiert – bitte später erneut prüfen."
        : group.resource_group_status !== "ACTIVE"
          ? "Flugbetrieb für dieses Produkt pausiert – bitte Status erneut prüfen."
          : group.operational_interrupted === 1
            ? "Flugbetrieb unterbrochen – bitte Status erneut prüfen."
            : freshness.reason === "STALE_PREDICTION"
              ? "Prognose wird aktualisiert – bitte Status erneut prüfen."
              : publicStatus === "COME_TO_FLIGHT_LINE"
                ? "Bitte jetzt zum Gate kommen."
                : publicStatus === "BOARDING"
                  ? "Bitte am Gate zum Einstieg bereithalten."
                  : publicStatus === "PREPARE"
                    ? "Ihr Aufruf steht bevor. Bitte bereithalten."
                    : publicStatus === "IN_FLIGHT"
                      ? "Ihr Rundflug ist gestartet."
                      : publicStatus === "LANDED"
                        ? "Ihr Rundflug ist gelandet."
                        : publicStatus === "COMPLETED"
                          ? "Ihr Rundflug ist abgeschlossen."
                          : "Bitte Status regelmäßig prüfen.";
    return {
      partNumber: index + 1,
      partCount,
      passengerCount: rotation.passenger_count,
      gateLabel: rotation.gate_label,
      status: publicStatus,
      queuePosition: rotation.status === "DRAFT" ? rotation.queue_position : null,
      boardingWindowLowerAt: boardingWindow.lowerAt,
      boardingWindowUpperAt: boardingWindow.upperAt,
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
    operationalNotice: group.resource_group_operational_note || group.event_operational_note,
    updatedAt: group.updated_at,
    parts,
  });
});

app.get("/api/public/push/config", (context) => {
  if (!context.env.VAPID_PUBLIC_KEY) {
    return context.json(
      { error: { code: "PUSH_NOT_CONFIGURED", message: "Web-Push ist noch nicht eingerichtet." } },
      503,
    );
  }
  return context.json({
    publicKey: context.env.VAPID_PUBLIC_KEY,
    retentionDays: pushRetentionDays(context.env.PUSH_RETENTION_DAYS),
  });
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
        consented_at, delete_after, status, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'TICKET', ?5, ?6, ?7, ?8, ?9, 'ACTIVE', ?8)
     ON CONFLICT(endpoint) DO UPDATE SET ticket_id = excluded.ticket_id,
       ticket_group_id = excluded.ticket_group_id, operation_day_id = excluded.operation_day_id,
       target_kind = excluded.target_kind, p256dh = excluded.p256dh, auth = excluded.auth,
       consented_at = excluded.consented_at, delete_after = excluded.delete_after,
       status = 'ACTIVE', updated_at = excluded.updated_at`,
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
        consented_at, delete_after, status, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'GROUP', ?5, ?6, ?7, ?8, ?9, 'ACTIVE', ?8)
     ON CONFLICT(endpoint) DO UPDATE SET ticket_id = excluded.ticket_id,
       ticket_group_id = excluded.ticket_group_id, operation_day_id = excluded.operation_day_id,
       target_kind = excluded.target_kind, p256dh = excluded.p256dh, auth = excluded.auth,
       consented_at = excluded.consented_at, delete_after = excluded.delete_after,
       status = 'ACTIVE', updated_at = excluded.updated_at`,
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
  const eventId = context.req.param("eventId");
  const requestedGateId = context.req.query("gateId")?.trim() || null;
  const event = await context.env.DB.prepare(
    "SELECT name, time_zone, emergency_mode, operational_interrupted, operational_note, departed_visibility_seconds, updated_at FROM operation_days WHERE id = ?1",
  )
    .bind(eventId)
    .first<{
      name: string;
      time_zone: string;
      emergency_mode: number;
      operational_interrupted: number;
      operational_note: string;
      departed_visibility_seconds: number;
      updated_at: string;
    }>();
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
  const productFilterJson = JSON.stringify(displayFilter.productIds);
  const statusFilterJson = JSON.stringify(displayFilter.rotationStatuses);
  const departedVisibilityCutoff = new Date(
    Date.now() - event.departed_visibility_seconds * 1_000,
  ).toISOString();
  const rows = await context.env.DB.prepare(
    `SELECT COALESCE(MIN(p.name), 'Rundflug') AS product_name,
            COALESCE(MIN(p.code), 'RF') AS product_code,
            COALESCE(MIN(g.label), 'Flight Line') AS gate_label,
            COALESCE(tg.communication_number, fg.communication_number) AS communication_number,
            fg.precalled_at,
            COALESCE(fg.queue_position, fg.communication_number) AS queue_position, r.status,
            r.predicted_boarding_at, r.prediction_quality, r.prediction_lower_minutes,
            r.prediction_upper_minutes, r.prediction_updated_at,
            MIN(a.registration) AS aircraft_registration,
            MIN(a.operational_state) AS aircraft_operational_state,
            r.departed_at,
            COUNT(rt.ticket_id) AS ticket_count,
            rg.status AS resource_group_status,
            rg.operational_note AS resource_group_operational_note
       FROM rotations r
       JOIN flight_groups fg ON fg.id = r.flight_group_id
       JOIN resource_groups rg ON rg.id = fg.resource_group_id
       LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
       LEFT JOIN tickets t ON t.id = rt.ticket_id
       LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       LEFT JOIN products p ON p.id = tg.product_id
       LEFT JOIN gates g ON g.id = COALESCE(r.gate_id, p.gate_id)
       LEFT JOIN aircraft a ON a.id = r.aircraft_id
      WHERE r.operation_day_id = ?1 AND r.status <> 'CANCELED'
        AND (?2 IS NULL OR g.id = ?2)
        AND (?3 = '[]' OR p.id IN (SELECT value FROM json_each(?3)))
        AND (?4 = '[]' OR r.status IN (SELECT value FROM json_each(?4)))
        AND (r.status NOT IN ('IN_FLIGHT', 'LANDED', 'COMPLETED') OR r.departed_at > ?5)
      GROUP BY r.id, tg.id
      ORDER BY CASE
                 WHEN rg.status = 'ACTIVE'
                   AND (r.status = 'CALLED'
                     OR (r.status = 'DRAFT' AND fg.precalled_at IS NOT NULL)) THEN 0
                 WHEN r.status = 'DRAFT' THEN 1
                 ELSE 2
               END,
               CASE
                 WHEN rg.status = 'ACTIVE'
                   AND (r.status = 'CALLED'
                     OR (r.status = 'DRAFT' AND fg.precalled_at IS NOT NULL))
                   THEN COALESCE(fg.queue_position, fg.communication_number)
               END,
               CASE WHEN r.status = 'DRAFT'
                 THEN COALESCE(fg.queue_position, fg.communication_number) END,
               CASE WHEN r.status IN ('IN_FLIGHT', 'LANDED', 'COMPLETED')
                 THEN r.departed_at END DESC,
               COALESCE(tg.communication_number, fg.communication_number)
      LIMIT 20`,
  )
    .bind(eventId, requestedGateId, productFilterJson, statusFilterJson, departedVisibilityCutoff)
    .all<{
      product_name: string;
      product_code: string;
      gate_label: string;
      communication_number: number;
      precalled_at: string | null;
      queue_position: number;
      status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      predicted_boarding_at: string | null;
      prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
      prediction_lower_minutes: number | null;
      prediction_upper_minutes: number | null;
      prediction_updated_at: string | null;
      aircraft_registration: string | null;
      aircraft_operational_state: string | null;
      departed_at: string | null;
      ticket_count: number;
      resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
      resource_group_operational_note: string;
    }>();
  const fleet = await context.env.DB.prepare(
    `SELECT a.registration, a.operational_state, a.refuel_planned
       FROM aircraft a
       JOIN resource_group_memberships m ON m.aircraft_id = a.id
      WHERE m.operation_day_id = ?1 AND m.active_until IS NULL
      GROUP BY a.id, a.registration, a.operational_state, a.refuel_planned
      ORDER BY a.registration`,
  )
    .bind(eventId)
    .all<{ registration: string; operational_state: string; refuel_planned: number }>();
  const publicState = {
    DRAFT: "WAITING",
    CALLED: "COME_TO_FLIGHT_LINE",
    IN_FLIGHT: "IN_FLIGHT",
    LANDED: "LANDED",
    COMPLETED: "COMPLETED",
  } as const;
  const boardReadAt = new Date().toISOString();
  return context.json({
    eventName: event.name,
    timeZone: event.time_zone,
    selectedGate: selectedGate
      ? { id: selectedGate.id, label: selectedGate.label, displayFilter }
      : null,
    emergencyMode: event.emergency_mode === 1,
    operationalInterrupted: event.operational_interrupted === 1,
    operationalNotice: event.operational_note,
    departedVisibilitySeconds: event.departed_visibility_seconds,
    updatedAt: event.updated_at,
    groups: event.emergency_mode
      ? []
      : rows.results.map((row, index) => {
          const forecastFreshness = assessForecastFreshness({
            predictionQuality: row.prediction_quality,
            predictionUpdatedAt: row.prediction_updated_at,
            now: boardReadAt,
          });
          const predictionQuality =
            event.operational_interrupted === 1 || row.resource_group_status !== "ACTIVE"
              ? "UNCERTAIN"
              : forecastFreshness.quality;
          const waitLowerMinutes = row.prediction_lower_minutes ?? index * 20;
          const waitUpperMinutes = row.prediction_upper_minutes ?? (index + 1) * 30;
          const boardingWindow = predictedBoardingWindow({
            status: row.status,
            quality: predictionQuality,
            predictedBoardingAt: row.predicted_boarding_at,
            lowerMinutes: waitLowerMinutes,
            upperMinutes: waitUpperMinutes,
            referenceAt: boardReadAt,
          });
          return {
            productName: row.product_name,
            productCode: row.product_code,
            gateLabel: row.gate_label,
            communicationNumber: row.communication_number,
            ticketLabels: Array.from(
              { length: row.ticket_count },
              (_, ticketIndex) =>
                `${formatBookingGroupLabel(row.product_code, row.communication_number)}/${ticketIndex + 1}`,
            ),
            aircraftRegistration: row.aircraft_registration,
            departedAt: row.departed_at,
            status:
              row.resource_group_status !== "ACTIVE"
                ? "SERVICE_PAUSED"
                : row.status === "DRAFT" && row.precalled_at !== null
                  ? "COME_TO_FLIGHT_LINE"
                  : row.status === "CALLED" && row.aircraft_operational_state === "BOARDING"
                    ? "BOARDING"
                    : publicState[row.status],
            waitLowerMinutes:
              event.operational_interrupted === 1 || row.resource_group_status !== "ACTIVE"
                ? 0
                : waitLowerMinutes,
            waitUpperMinutes:
              event.operational_interrupted === 1 || row.resource_group_status !== "ACTIVE"
                ? 0
                : waitUpperMinutes,
            boardingWindowLowerAt: boardingWindow.lowerAt,
            boardingWindowUpperAt: boardingWindow.upperAt,
            predictionQuality,
            operationalNotice: row.resource_group_operational_note,
          };
        }),
    fleet: event.emergency_mode
      ? []
      : fleet.results.map((aircraft) => ({
          registration: aircraft.registration,
          status: aircraft.operational_state,
          refuelPlanned: aircraft.refuel_planned === 1,
        })),
  });
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
        timestamp: now.toISOString(),
      }),
    );
  },
};
