import { sha256Hex } from "./crypto";
import type { Env } from "./types";

const RESET_SETUP_COOKIE = "__Host-rls_reset_setup";
const LOCAL_RESET_SETUP_COOKIE = "rls_reset_setup";
export const RESET_SETUP_GRANT_MINUTES = 30;

type ResetSetupGrantRow = {
  command_id: string;
  completed_at: string;
  setup_grant_expires_at: string;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function cookieName(request: Request): string {
  return new URL(request.url).protocol === "https:" ? RESET_SETUP_COOKIE : LOCAL_RESET_SETUP_COOKIE;
}

function resetSetupSigningKey(env: Env): string | null {
  return (
    env.RESET_SETUP_SIGNING_KEY ?? env.INSTALLATION_RECOVERY_CODE ?? env.BOOTSTRAP_TOKEN ?? null
  );
}

export function installationRecoveryCode(env: Env): string | null {
  return env.INSTALLATION_RECOVERY_CODE ?? env.BOOTSTRAP_TOKEN ?? null;
}

export async function resetSetupToken(
  env: Env,
  commandId: string,
  completedAt: string,
): Promise<string | null> {
  const signingKey = resetSetupSigningKey(env);
  if (!signingKey) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`reset-setup:${commandId}:${completedAt}`),
  );
  return base64Url(new Uint8Array(signature));
}

export function resetSetupGrantExpiry(completedAt: Date): string {
  return new Date(completedAt.getTime() + RESET_SETUP_GRANT_MINUTES * 60_000).toISOString();
}

export function resetSetupCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(request)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${
    RESET_SETUP_GRANT_MINUTES * 60
  }${secure}`;
}

export function clearedResetSetupCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(request)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function validResetSetupGrant(
  env: Env,
  request: Request,
  now = new Date(),
): Promise<ResetSetupGrantRow | null> {
  const token = cookieValue(request, cookieName(request));
  if (!token || token.length < 32 || token.length > 256) return null;
  const tokenHash = await sha256Hex(token);
  return env.DB.prepare(
    `SELECT command_id, completed_at, setup_grant_expires_at
       FROM system_reset_receipts
      WHERE setup_grant_hash = ?1
        AND setup_grant_used_at IS NULL
        AND setup_grant_expires_at > ?2`,
  )
    .bind(tokenHash, now.toISOString())
    .first<ResetSetupGrantRow>();
}
