import { authorizeSession, type OperatorRole, type SessionActor } from "./auth";
import { verifyCredential } from "./crypto";
import type { Env } from "./types";

export interface AuthorizedDevice {
  id: string;
  role: OperatorRole;
  accountId: string | null;
  loginCode: string | null;
}

const defaultDependencies = {
  authorizeSession,
  verifyCredential,
};

type DeviceAuthorizationDependencies = typeof defaultDependencies;

export async function authorizeDevice(
  env: Env,
  eventId: string,
  request: Request,
  preauthorizedActor?: SessionActor | null,
  dependencies: DeviceAuthorizationDependencies = defaultDependencies,
): Promise<AuthorizedDevice | null> {
  const actor =
    preauthorizedActor === undefined
      ? await dependencies.authorizeSession(env, request)
      : preauthorizedActor;
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
  if (!device || !(await dependencies.verifyCredential(token ?? null, device.credential_hash))) {
    return null;
  }
  await env.DB.prepare("UPDATE paired_devices SET last_seen_at = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), deviceId)
    .run();
  return { id: deviceId, role: device.role, accountId: null, loginCode: null };
}
