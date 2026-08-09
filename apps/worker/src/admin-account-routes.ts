import { createOperatorAccountSchema, updateOperatorAccountSchema } from "@rundflug/contracts";
import type { Hono } from "hono";
import {
  assertRole,
  authorizeSession,
  nextLoginCode,
  type OperatorRole,
  type SessionActor,
} from "./auth";
import { hashPin } from "./crypto";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeSession,
  nextLoginCode,
  hashPin,
};

type AdminAccountRouteDependencies = typeof defaultDependencies;

export function registerAdminAccountRoutes(
  app: WorkerApp,
  dependencies: AdminAccountRouteDependencies = defaultDependencies,
) {
  app.get("/api/admin/operator-accounts", async (context) => {
    const actor = assertRole(await dependencies.authorizeSession(context.env, context.req.raw), [
      "ADMIN",
    ]);
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
    const actor = assertRole(await dependencies.authorizeSession(context.env, context.req.raw), [
      "ADMIN",
    ]);
    if (!actor)
      return context.json({ error: { code: "FORBIDDEN", message: "Nicht autorisiert." } }, 403);
    const parsed = createOperatorAccountSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_ACCOUNT", message: "Kontodaten sind ungültig." } },
        400,
      );
    }
    const id = crypto.randomUUID();
    const loginCode = await dependencies.nextLoginCode(context.env, parsed.data.role);
    const pinHash = await dependencies.hashPin(parsed.data.pin);
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
    const actor = assertRole(await dependencies.authorizeSession(context.env, context.req.raw), [
      "ADMIN",
    ]);
    if (!actor)
      return context.json({ error: { code: "FORBIDDEN", message: "Nicht autorisiert." } }, 403);
    const parsed = updateOperatorAccountSchema.safeParse(
      await context.req.json().catch(() => null),
    );
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
    const pinHash = parsed.data.pin ? await dependencies.hashPin(parsed.data.pin) : null;
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
    const actor = assertRole(await dependencies.authorizeSession(context.env, context.req.raw), [
      "ADMIN",
    ]);
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
}
