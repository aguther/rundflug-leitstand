import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActiveEventProvider,
  rememberActiveEvent,
  resolveActiveEvent,
  useActiveEvent,
} from "./event-context";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("active event context", () => {
  it("provides the validated event at render time", () => {
    function EventConsumer() {
      const activeEvent = useActiveEvent();
      return createElement("span", null, `${activeEvent.eventId}:${activeEvent.eventName}`);
    }

    expect(
      renderToStaticMarkup(
        createElement(
          ActiveEventProvider,
          { eventId: "event-2026", eventName: "Rundflug 2026" },
          createElement(EventConsumer),
        ),
      ),
    ).toContain("event-2026:Rundflug 2026");
  });

  it("prefers an event selected through the URL without persisting it before validation", () => {
    const storage = memoryStorage();
    expect(resolveActiveEvent("?event=rundflug-2026", storage)).toBe("rundflug-2026");
    expect(resolveActiveEvent("", storage)).toBe("");

    rememberActiveEvent(storage, "rundflug-2026");
    expect(resolveActiveEvent("", storage)).toBe("rundflug-2026");
  });

  it("remembers the event supplied by setup or device pairing", () => {
    const storage = memoryStorage();
    rememberActiveEvent(storage, "event-from-pairing");
    expect(resolveActiveEvent("", storage)).toBe("event-from-pairing");
  });

  it("does not silently select a production event without persisted context", () => {
    expect(resolveActiveEvent("", memoryStorage())).toBe("");
    expect(resolveActiveEvent("", memoryStorage(), "demo-2026")).toBe("demo-2026");
  });
});
