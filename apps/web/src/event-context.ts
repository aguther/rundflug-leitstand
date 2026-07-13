const ACTIVE_EVENT_STORAGE_KEY = "active-event-id";

type EventStorage = Pick<Storage, "getItem" | "setItem">;

export function rememberActiveEvent(storage: EventStorage, eventId: string): void {
  const normalized = eventId.trim();
  if (normalized) storage.setItem(ACTIVE_EVENT_STORAGE_KEY, normalized);
}

export function resolveActiveEvent(
  search: string,
  storage: EventStorage,
  fallback = "demo-2026",
): string {
  const requested = new URLSearchParams(search).get("event")?.trim();
  if (requested) {
    rememberActiveEvent(storage, requested);
    return requested;
  }
  return storage.getItem(ACTIVE_EVENT_STORAGE_KEY)?.trim() || fallback;
}
