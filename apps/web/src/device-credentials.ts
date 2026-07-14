const DEVICE_TOKEN_PREFIX = "device-token:";
const ROLE_TOKEN_PREFIX = "device-role-token:";
const MAX_RECOVERY_CANDIDATES = 32;

type CredentialStorage = Pick<Storage, "getItem" | "setItem" | "key" | "length">;

export function rememberDeviceCredential(
  storage: CredentialStorage,
  role: string,
  deviceId: string,
  token: string,
): void {
  storage.setItem(`device-id:${role}`, deviceId);
  storage.setItem(`${DEVICE_TOKEN_PREFIX}${deviceId}`, token);
  storage.setItem(`${ROLE_TOKEN_PREFIX}${role}`, token);
}

export function deviceCredentialToken(
  storage: CredentialStorage,
  role: string | null,
  deviceId: string,
): string | null {
  const exactToken = storage.getItem(`${DEVICE_TOKEN_PREFIX}${deviceId}`);
  if (exactToken) return exactToken;
  return role ? storage.getItem(`${ROLE_TOKEN_PREFIX}${role}`) : null;
}

export function deviceCredentialCandidates(
  storage: CredentialStorage,
  role: string | null,
  deviceId: string,
): string[] {
  const candidates = new Set<string>();
  const current = deviceCredentialToken(storage, role, deviceId);
  if (current) candidates.add(current);

  // Releases before the role token existed stored the administrator credential only under the
  // former device ID. A cloned event intentionally keeps the same credential hash, so a locally
  // held former token can safely repair the binding without weakening server-side authorization.
  for (
    let index = 0;
    index < storage.length && candidates.size < MAX_RECOVERY_CANDIDATES;
    index += 1
  ) {
    const key = storage.key(index);
    if (!key?.startsWith(DEVICE_TOKEN_PREFIX)) continue;
    const token = storage.getItem(key);
    if (token) candidates.add(token);
  }

  return [...candidates];
}
