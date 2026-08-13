import type { OperatorRole } from "./auth";
import type { Env } from "./types";

export interface LoginAccount {
  id: string;
  login_code: string;
  role: OperatorRole;
  pin_hash: string;
  active: number;
  failed_attempts: number;
  locked_until: string | null;
  session_version: number;
}

export async function recordFailedLogin(
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
