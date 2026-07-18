import { sha256Hex } from "./crypto";
import type { Env } from "./types";

export const SESSION_COOKIE = "rls_session";
export const SESSION_ABSOLUTE_HOURS = 16;

export const operatorRoles = ["CASHIER", "FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"] as const;
export type OperatorRole = (typeof operatorRoles)[number];

export type SessionActor = {
  accountId: string;
  loginCode: string;
  role: OperatorRole;
  sessionId: string;
  deviceId: string;
};

function addMinutes(value: Date, minutes: number): string {
  return new Date(value.getTime() + minutes * 60_000).toISOString();
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string, request: Request, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearedSessionCookie(request: Request): string {
  return sessionCookie("", request, 0);
}

export async function authorizeSession(env: Env, request: Request): Promise<SessionActor | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length < 32 || token.length > 256) return null;
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.account_id, s.device_id, s.session_version,
            s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
            a.login_code, a.role, a.session_version AS account_session_version
       FROM operator_sessions s
       JOIN operator_accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?1 AND s.revoked_at IS NULL AND a.active = 1`,
  )
    .bind(tokenHash)
    .first<{
      session_id: string;
      account_id: string;
      device_id: string;
      session_version: number;
      last_seen_at: string;
      idle_expires_at: string;
      absolute_expires_at: string;
      login_code: string;
      role: OperatorRole;
      account_session_version: number;
    }>();
  if (
    !row ||
    row.session_version !== row.account_session_version ||
    Date.parse(row.absolute_expires_at) <= now.getTime()
  ) {
    return null;
  }

  if (now.getTime() - Date.parse(row.last_seen_at) >= 5 * 60_000) {
    await env.DB.prepare(
      `UPDATE operator_sessions SET last_seen_at = ?1, idle_expires_at = ?2
        WHERE id = ?3 AND revoked_at IS NULL`,
    )
      .bind(now.toISOString(), row.absolute_expires_at, row.session_id)
      .run();
  }

  return {
    accountId: row.account_id,
    loginCode: row.login_code,
    role: row.role,
    sessionId: row.session_id,
    deviceId: row.device_id,
  };
}

export function assertRole(
  actor: SessionActor | null,
  roles: readonly OperatorRole[],
): SessionActor | null {
  return actor && roles.includes(actor.role) ? actor : null;
}

export function sessionTimes(_role: OperatorRole, now = new Date()) {
  const absoluteExpiresAt = addMinutes(now, SESSION_ABSOLUTE_HOURS * 60);
  return {
    createdAt: now.toISOString(),
    idleExpiresAt: absoluteExpiresAt,
    absoluteExpiresAt,
    maxAgeSeconds: SESSION_ABSOLUTE_HOURS * 60 * 60,
  };
}

const ROLE_PREFIX: Record<OperatorRole, string> = {
  ADMIN: "ADMIN",
  CASHIER: "KASSE",
  FLIGHT_LINE: "FL",
  FLIGHT_DIRECTOR: "LEIT",
};

export async function nextLoginCode(env: Env, role: OperatorRole): Promise<string> {
  const prefix = ROLE_PREFIX[role];
  const rows = await env.DB.prepare(
    "SELECT login_code FROM operator_accounts WHERE role = ?1 ORDER BY login_code",
  )
    .bind(role)
    .all<{ login_code: string }>();
  const used = new Set(
    rows.results
      .map((row) => Number.parseInt(row.login_code.slice(prefix.length + 1), 10))
      .filter(Number.isSafeInteger),
  );
  let number = 1;
  while (used.has(number)) number += 1;
  return `${prefix}-${String(number).padStart(2, "0")}`;
}
