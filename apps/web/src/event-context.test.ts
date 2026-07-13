import { describe, expect, it } from "vitest";
import { rememberActiveEvent, resolveActiveEvent } from "./event-context";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("active event context", () => {
  it("persists an event selected through the URL for later reloads", () => {
    const storage = memoryStorage();
    expect(resolveActiveEvent("?event=rundflug-2026", storage)).toBe("rundflug-2026");
    expect(resolveActiveEvent("", storage)).toBe("rundflug-2026");
  });

  it("remembers the event supplied by setup or device pairing", () => {
    const storage = memoryStorage();
    rememberActiveEvent(storage, "event-from-pairing");
    expect(resolveActiveEvent("", storage)).toBe("event-from-pairing");
  });

  it("uses the development fallback only without persisted context", () => {
    expect(resolveActiveEvent("", memoryStorage())).toBe("demo-2026");
  });
});
