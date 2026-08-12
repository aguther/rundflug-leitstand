import { createContext, type ReactNode, useContext, useMemo } from "react";

const ACTIVE_EVENT_STORAGE_KEY = "active-event-id";
const ACTIVE_EVENT_LABEL_STORAGE_KEY = "active-event-label";

type EventStorage = Pick<Storage, "getItem" | "setItem">;

export interface ActiveEventContextValue {
  eventId: string;
  eventName: string;
}

const ActiveEventContext = createContext<ActiveEventContextValue | null>(null);

export function ActiveEventProvider({
  children,
  eventId,
  eventName,
}: ActiveEventContextValue & { children?: ReactNode }) {
  const value = useMemo(() => ({ eventId, eventName }), [eventId, eventName]);
  return <ActiveEventContext.Provider value={value}>{children}</ActiveEventContext.Provider>;
}

export function useActiveEvent(): ActiveEventContextValue {
  const activeEvent = useContext(ActiveEventContext);
  if (!activeEvent) {
    throw new Error("Active event context is unavailable for this route.");
  }
  return activeEvent;
}

export function useOptionalActiveEvent(): ActiveEventContextValue | null {
  return useContext(ActiveEventContext);
}

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
  if (requested) return requested;
  return storage.getItem(ACTIVE_EVENT_STORAGE_KEY)?.trim() || fallback;
}
