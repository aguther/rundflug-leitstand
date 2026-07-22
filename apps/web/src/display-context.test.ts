import { describe, expect, it } from "vitest";
import { rememberDisplayBinding, resolveDisplayBinding } from "./display-context";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("display binding", () => {
  it("keeps event and gate together", () => {
    const storage = memoryStorage();
    rememberDisplayBinding(storage, {
      eventId: "event-a",
      gateId: "gate-2",
    });
    expect(resolveDisplayBinding("", storage, "event-a")).toEqual({
      eventId: "event-a",
      gateId: "gate-2",
    });
  });

  it("never carries a gate binding into another event", () => {
    const storage = memoryStorage();
    rememberDisplayBinding(storage, {
      eventId: "event-a",
      gateId: "gate-2",
    });
    expect(resolveDisplayBinding("", storage, "event-b")).toEqual({
      eventId: "event-b",
      gateId: null,
    });
  });

  it("accepts an explicit gate and ignores obsolete terminal styling", () => {
    const storage = memoryStorage();
    expect(resolveDisplayBinding("?gateId=gate-main&style=terminal", storage, "event-a")).toEqual({
      eventId: "event-a",
      gateId: "gate-main",
    });
    expect(resolveDisplayBinding("", storage, "event-a").gateId).toBe("gate-main");
  });
});
