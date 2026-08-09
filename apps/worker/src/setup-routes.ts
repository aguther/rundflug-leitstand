import { bootstrapRequestSchema } from "@rundflug/contracts";
import type { Hono } from "hono";
import { clearedSessionCookie, type SessionActor } from "./auth";
import { hashPin, sha256Hex, verifyCredential } from "./crypto";
import { allowSetupAttempt } from "./public-access";
import {
  clearedResetSetupCookie,
  installationRecoveryCode,
  validResetSetupGrant,
} from "./reset-setup-grant";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  allowSetupAttempt,
  clearedResetSetupCookie,
  clearedSessionCookie,
  hashPin,
  installationRecoveryCode,
  now: () => new Date(),
  randomUuid: (): string => crypto.randomUUID(),
  sha256Hex,
  validResetSetupGrant,
  verifyCredential,
};

type SetupRouteDependencies = typeof defaultDependencies;

export function registerSetupRoutes(
  app: WorkerApp,
  dependencies: SetupRouteDependencies = defaultDependencies,
) {
  app.get("/api/setup/status", async (context) => {
    const state = await context.env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM app_bootstrap) AS completed,
        (SELECT COUNT(*) FROM operation_days) AS events,
        (SELECT COUNT(*) FROM operator_accounts
          WHERE role = 'ADMIN' AND active = 1 AND deleted_at IS NULL) AS admins`,
    ).first<{ completed: number; events: number; admins: number }>();
    const resetGrant = await dependencies.validResetSetupGrant(context.env, context.req.raw);
    return context.json({
      setupRequired:
        (state?.completed ?? 0) === 0 && (state?.events ?? 0) === 0 && (state?.admins ?? 0) === 0,
      setupConfigured: Boolean(dependencies.installationRecoveryCode(context.env) || resetGrant),
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
        {
          error: { code: "SETUP_ALREADY_COMPLETED", message: "Ersteinrichtung ist abgeschlossen." },
        },
        409,
      );
    }
    const resetGrant = await dependencies.validResetSetupGrant(context.env, context.req.raw);
    const recoveryCode = dependencies.installationRecoveryCode(context.env);
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
      !(await dependencies.allowSetupAttempt(
        context.env.ADMIN_RECOVERY_RATE_LIMITER,
        context.req.raw,
      ))
    ) {
      return context.json(
        { error: { code: "SETUP_CREDENTIALS_INVALID", message: "Einrichtung nicht autorisiert." } },
        429,
        { "retry-after": "60" },
      );
    }
    const recoveryCodeHash = recoveryCode ? await dependencies.sha256Hex(recoveryCode) : null;
    if (
      !resetGrant &&
      !(await dependencies.verifyCredential(parsed.data.setupCode ?? null, recoveryCodeHash))
    ) {
      return context.json(
        { error: { code: "SETUP_CREDENTIALS_INVALID", message: "Einrichtung nicht autorisiert." } },
        403,
      );
    }
    const input = parsed.data;
    const now = dependencies.now().toISOString();
    const adminDeviceId =
      context.env.APP_ENV === "development" && input.adminDeviceId
        ? input.adminDeviceId
        : dependencies.randomUuid();
    const adminCredentialHash =
      context.env.APP_ENV === "development" ? (input.adminCredentialHash ?? null) : null;
    const adminAccountId = dependencies.randomUuid();
    const adminPinHash = await dependencies.hashPin(input.adminPin);
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
          dependencies.randomUuid(),
          input.eventId,
          now,
          adminDeviceId,
          JSON.stringify({ anonymousAdministration: true }),
        ),
        context.env.DB.prepare(
          `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
           VALUES (?1, ?2, 'SYSTEM_BOOTSTRAPPED', ?3, ?4)`,
        ).bind(
          dependencies.randomUuid(),
          input.eventId,
          JSON.stringify({ eventId: input.eventId }),
          now,
        ),
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
        {
          error: { code: "SETUP_ALREADY_COMPLETED", message: "Ersteinrichtung ist abgeschlossen." },
        },
        409,
      );
    }
    context.header("set-cookie", dependencies.clearedResetSetupCookie(context.req.raw));
    context.header("set-cookie", dependencies.clearedSessionCookie(context.req.raw), {
      append: true,
    });
    return context.json(
      {
        eventId: input.eventId,
        ...(context.env.APP_ENV === "development" ? { adminDeviceId } : {}),
      },
      201,
    );
  });
}
