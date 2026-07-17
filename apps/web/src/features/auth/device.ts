const DEVICE_ID_KEY = "rundflug-operator-device-id";

export function operatorDeviceId(): string {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}
