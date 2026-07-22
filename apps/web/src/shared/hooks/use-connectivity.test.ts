import { describe, expect, it } from "vitest";
import { resolveConnectionStatus } from "./use-connectivity";

describe("operational connection status", () => {
  it("does not report connected before the backend confirms a state", () => {
    expect(
      resolveConnectionStatus({
        online: true,
        backendConfirmed: false,
        lastConfirmedAt: "2026-07-22T07:59:00.000Z",
      }),
    ).toBe("checking");
  });

  it("distinguishes browser offline, backend failure and confirmed recovery", () => {
    expect(
      resolveConnectionStatus({
        online: false,
        error: "Backend nicht erreichbar",
        lastConfirmedAt: "2026-07-22T08:00:00.000Z",
      }),
    ).toBe("offline");
    expect(
      resolveConnectionStatus({
        online: true,
        error: "Backend nicht erreichbar",
        lastConfirmedAt: "2026-07-22T08:00:00.000Z",
      }),
    ).toBe("degraded");
    expect(
      resolveConnectionStatus({
        online: true,
        backendConfirmed: true,
        error: null,
        lastConfirmedAt: "2026-07-22T08:01:00.000Z",
      }),
    ).toBe("connected");
  });

  it("preserves navigator-only behavior for shells without backend sync", () => {
    expect(resolveConnectionStatus({ online: true, tracksBackend: false })).toBe("connected");
  });
});
