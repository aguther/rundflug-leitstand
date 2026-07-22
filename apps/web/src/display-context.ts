export type DisplayBinding = {
  eventId: string;
  gateId: string | null;
};

const DISPLAY_BINDING_STORAGE_KEY = "display-binding";

type DisplayStorage = Pick<Storage, "getItem" | "setItem">;

export function rememberDisplayBinding(storage: DisplayStorage, binding: DisplayBinding): void {
  storage.setItem(DISPLAY_BINDING_STORAGE_KEY, JSON.stringify(binding));
}

function storedBinding(storage: DisplayStorage, eventId: string): DisplayBinding | null {
  try {
    const parsed = JSON.parse(
      storage.getItem(DISPLAY_BINDING_STORAGE_KEY) ?? "null",
    ) as Partial<DisplayBinding> | null;
    if (!parsed || parsed.eventId !== eventId) return null;
    return {
      eventId,
      gateId: typeof parsed.gateId === "string" && parsed.gateId.trim() ? parsed.gateId : null,
    };
  } catch {
    return null;
  }
}

export function resolveDisplayBinding(
  search: string,
  storage: DisplayStorage,
  eventId: string,
): DisplayBinding {
  const params = new URLSearchParams(search);
  const persisted = storedBinding(storage, eventId);
  const requestedGate = params.get("gateId")?.trim() || params.get("gate")?.trim() || null;
  const binding: DisplayBinding = {
    eventId,
    gateId: requestedGate ?? persisted?.gateId ?? null,
  };
  if (eventId && requestedGate !== null) {
    rememberDisplayBinding(storage, binding);
  }
  return binding;
}
