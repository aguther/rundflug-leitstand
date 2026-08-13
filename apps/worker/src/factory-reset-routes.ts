import { type FactoryResetResponse, factoryResetRequestSchema } from "@rundflug/contracts";
import type { Hono } from "hono";
import { authorizeSession, type SessionActor, sessionBrowserBindingHash } from "./auth";
import { createPortableBackup } from "./backup";
import { sha256Hex, verifyPin } from "./crypto";
import { authorizeDevice } from "./device-authorization";
import {
  clearFactoryResetCoordinators,
  factoryResetRequestHash,
  factoryResetStatements,
  finishR2Cleanup,
} from "./factory-reset";
import {
  type FactoryResetReceipt,
  finalizeFactoryReset,
  replayFactoryReset,
} from "./factory-reset-route-support";
import { allowLoginAttempt } from "./public-access";
import { resetSetupCookie, resetSetupGrantExpiry, resetSetupToken } from "./reset-setup-grant";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

function eventCoordinatorNamespace(env: Env): Env["EVENT_COORDINATOR"] {
  return env.APP_ENV === "development"
    ? env.EVENT_COORDINATOR
    : env.EVENT_COORDINATOR.jurisdiction("eu");
}

const defaultDependencies = {
  allowLoginAttempt,
  authorizeDevice,
  authorizeSession,
  clearFactoryResetCoordinators,
  createPortableBackup,
  eventCoordinatorNamespace,
  factoryResetRequestHash,
  factoryResetStatements,
  finishR2Cleanup,
  now: () => new Date(),
  resetSetupCookie,
  resetSetupGrantExpiry,
  resetSetupToken,
  sessionBrowserBindingHash,
  sha256Hex,
  verifyPin,
};

export type FactoryResetRouteDependencies = typeof defaultDependencies;

export function registerFactoryResetRoutes(
  app: WorkerApp,
  dependencyOverrides: Partial<FactoryResetRouteDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  app.post("/api/admin/events/:eventId/factory-reset", async (context) => {
    const parsed = factoryResetRequestSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success || parsed.data.eventId !== context.req.param("eventId")) {
      return context.json(
        { error: { code: "INVALID_FACTORY_RESET", message: "Reset-Daten sind unvollständig." } },
        400,
      );
    }
    const input = parsed.data;
    const requestHash = await dependencies.factoryResetRequestHash(input);
    const prior = await context.env.DB.prepare(
      `SELECT request_hash, completed_at, r2_cleanup_pending, response_json,
              setup_browser_binding_hash
         FROM system_reset_receipts WHERE command_id = ?1`,
    )
      .bind(input.commandId)
      .first<FactoryResetReceipt>();
    if (prior) {
      return replayFactoryReset(context, dependencies, input, requestHash, prior);
    }

    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    const authorized = await dependencies.authorizeDevice(
      context.env,
      input.eventId,
      context.req.raw,
      actor,
    );
    if (actor?.role !== "ADMIN" || authorized?.role !== "ADMIN") {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    const browserBindingHash = await dependencies.sessionBrowserBindingHash(context.req.raw);
    if (!browserBindingHash) {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    if (
      !(await dependencies.allowLoginAttempt(
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
    if (!account || !(await dependencies.verifyPin(input.adminPin, account.pin_hash))) {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    const completedAt = dependencies.now();
    const grantToken = await dependencies.resetSetupToken(
      context.env,
      input.commandId,
      completedAt.toISOString(),
    );
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
    const grantHash = await dependencies.sha256Hex(grantToken);
    const grantExpiresAt = dependencies.resetSetupGrantExpiry(completedAt);

    const eventRows = await context.env.DB.prepare("SELECT id FROM operation_days").all<{
      id: string;
    }>();
    let recoveryBackupKey: string | null = null;
    if (input.retainRecoveryBackup) {
      try {
        recoveryBackupKey = (
          await dependencies.createPortableBackup(context.env, dependencies.now(), "FACTORY_RESET")
        ).key;
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
    const coordinator = dependencies.eventCoordinatorNamespace(context.env);
    try {
      await dependencies.clearFactoryResetCoordinators(
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
        dependencies.factoryResetStatements(context.env, {
          commandId: input.commandId,
          completedAt: completedAt.toISOString(),
          r2CleanupPending: input.deleteAllBackups,
          requestHash,
          response,
          setupBrowserBindingHash: browserBindingHash,
          setupGrantExpiresAt: grantExpiresAt,
          setupGrantHash: grantHash,
        }),
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
    return finalizeFactoryReset(context, dependencies, input, response, grantToken);
  });
}
