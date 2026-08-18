import { adminDeviceRecoverySchema, adminPinVerificationSchema } from "@rundflug/contracts";
import type { Hono } from "hono";
import { authorizeSession, type SessionActor } from "./auth";
import { verifyCredential, verifyPin } from "./crypto";
import { authorizeDevice } from "./device-authorization";
import { allowAdminDeviceRecoveryAttempt } from "./public-access";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeSession,
  authorizeDevice,
  verifyCredential,
  verifyPin,
  allowAdminDeviceRecoveryAttempt,
};

type AdminSecurityRouteDependencies = typeof defaultDependencies;

export function registerAdminSecurityRoutes(
  app: WorkerApp,
  dependencies: AdminSecurityRouteDependencies = defaultDependencies,
) {
  app.get("/api/device/context", async (context) => {
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
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
      !(await dependencies.verifyCredential(
        context.req.header("x-device-token") ?? null,
        device.credential_hash,
      ))
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
    const authorized = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    if (
      authorized?.role !== "ADMIN" ||
      (!actor &&
        !(await dependencies.verifyCredential(
          parsed.data.adminPin,
          Reflect.get(context.env, "ADMIN_PIN_HASH") ?? null,
        )))
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
      !(await dependencies.allowAdminDeviceRecoveryAttempt(
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
        adminAccounts.results.map((account) =>
          dependencies.verifyPin(parsed.data.adminPin, account.pin_hash),
        ),
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
}
