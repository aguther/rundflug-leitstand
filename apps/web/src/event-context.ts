const ACTIVE_EVENT_STORAGE_KEY = "active-event-id";
const ACTIVE_EVENT_LABEL_STORAGE_KEY = "active-event-label";

type EventStorage = Pick<Storage, "getItem" | "setItem">;

export function rememberActiveEvent(
  storage: EventStorage,
  eventId: string,
  eventLabel?: string,
): void {
  const normalized = eventId.trim();
  if (normalized) storage.setItem(ACTIVE_EVENT_STORAGE_KEY, normalized);
  const normalizedLabel = eventLabel?.trim();
  if (normalizedLabel) storage.setItem(ACTIVE_EVENT_LABEL_STORAGE_KEY, normalizedLabel);
}

export function activeEventLabel(storage: Pick<Storage, "getItem">): string | null {
  return storage.getItem(ACTIVE_EVENT_LABEL_STORAGE_KEY)?.trim() || null;
}

export function forgetActiveEvent(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(ACTIVE_EVENT_STORAGE_KEY);
  storage.removeItem(ACTIVE_EVENT_LABEL_STORAGE_KEY);
}

export function resolveActiveEvent(search: string, storage: EventStorage, fallback = ""): string {
  const requested = new URLSearchParams(search).get("event")?.trim();
  if (requested) {
    rememberActiveEvent(storage, requested);
    return requested;
  }
  return storage.getItem(ACTIVE_EVENT_STORAGE_KEY)?.trim() || fallback;
}
