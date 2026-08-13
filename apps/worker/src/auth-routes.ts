import { operatorLoginRequestSchema } from "@rundflug/contracts";
import type { Hono } from "hono";
import {
  authorizeSession,
  clearedSessionCookie,
  type OperatorRole,
  type SessionActor,
  sessionCookie,
  sessionTimes,
} from "./auth";
import { randomToken, sha256Hex, verifyPin } from "./crypto";
import { allowLoginAttempt } from "./public-access";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const LOGIN_ERROR = {
  error: { code: "LOGIN_FAILED", message: "Konto oder PIN ist nicht gültig." },
};

const defaultDependencies = {
  authorizeSession,
  allowLoginAttempt,
  verifyPin,
  randomToken,
  sha256Hex,
};

type AuthRouteDependencies = typeof defaultDependencies;

interface LoginAccount {
  id: string;
  login_code: string;
  role: OperatorRole;
  pin_hash: string;
  active: number;
  failed_attempts: number;
  locked_until: string | null;
  session_version: number;
}

async function recordFailedLogin(
  env: Env,
  account: LoginAccount | null,
  locked: boolean,
  now: Date,
) {
  if (!account || locked) return;
  const failedAttempts = account.failed_attempts + 1;
  const lockedUntil =
    failedAttempts >= 5 ? new Date(now.getTime() + 15 * 60_000).toISOString() : null;
  await env.DB.prepare(
    `UPDATE operator_accounts
        SET failed_attempts = ?1, locked_until = ?2, updated_at = ?3
      WHERE id = ?4`,
  )
    .bind(failedAttempts >= 5 ? 0 : failedAttempts, lockedUntil, now.toISOString(), account.id)
    .run();
}

export function registerAuthRoutes(
  app: WorkerApp,
  dependencies: AuthRouteDependencies = defaultDependencies,
) {
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
      !(await dependencies.allowLoginAttempt(
        context.env.ADMIN_RECOVERY_RATE_LIMITER,
        context.req.raw,
        accountId,
      ))
    ) {
      return context.json(LOGIN_ERROR, 429, { "retry-after": "60" });
    }

    const now = new Date();
    const account = await context.env.DB.prepare(
      `SELECT id, login_code, role, pin_hash, active, failed_attempts, locked_until, session_version
         FROM operator_accounts WHERE id = ?1 AND deleted_at IS NULL`,
    )
      .bind(accountId)
      .first<LoginAccount>();
    const locked = account?.locked_until && Date.parse(account.locked_until) > now.getTime();
    const valid =
      Boolean(account?.active) &&
      !locked &&
      Boolean(account && (await dependencies.verifyPin(pin, account.pin_hash)));
    if (!account || !valid) {
      await recordFailedLogin(context.env, account, Boolean(locked), now);
      return context.json(LOGIN_ERROR, 401);
    }

    const sessionId = crypto.randomUUID();
    const token = dependencies.randomToken();
    const tokenHash = await dependencies.sha256Hex(token);
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
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
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
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
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
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
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
}
