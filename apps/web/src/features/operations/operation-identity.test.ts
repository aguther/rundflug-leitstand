// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveOperationIdentity,
  useAdminOperationIdentity,
  useOperationIdentity,
} from "./operation-identity";

const activeEvent = vi.hoisted(() => ({ eventId: "event-2026" }));

vi.mock("../../event-context", () => ({
  useActiveEvent: () => ({ eventId: activeEvent.eventId }),
}));

afterEach(() => cleanup());

describe("operation identity resolution", () => {
  it.each([
    ["cashier-tablet-1", "demo-cashier-device-token"],
    ["flight-line-tablet-1", "demo-flight-line-device-token"],
    ["recovery-flight-lead", "lead-device-credential"],
    ["technical-scaffold", "demo-admin-device-token"],
  ])("uses the matching synthetic credential for demo device %s", (deviceId, deviceToken) => {
    expect(resolveOperationIdentity("demo-2026", "ADMIN", deviceId)).toEqual({
      eventId: "demo-2026",
      deviceId,
      deviceToken,
    });
  });

  it("uses a role-scoped session identity without a demo credential for real events", () => {
    expect(resolveOperationIdentity("event-2026", "FLIGHT_LINE", "flight-line-tablet-1")).toEqual({
      eventId: "event-2026",
      deviceId: "flight_line-session",
      deviceToken: "",
    });
  });

  it("updates the hook result when the active event changes", () => {
    activeEvent.eventId = "event-2026";
    const { result, rerender } = renderHook(() =>
      useOperationIdentity("CASHIER", "cashier-tablet-1"),
    );
    expect(result.current).toEqual({
      eventId: "event-2026",
      deviceId: "cashier-session",
      deviceToken: "",
    });

    activeEvent.eventId = "demo-2026";
    rerender();
    expect(result.current).toEqual({
      eventId: "demo-2026",
      deviceId: "cashier-tablet-1",
      deviceToken: "demo-cashier-device-token",
    });
  });

  it("provides the standard administrative development identity", () => {
    activeEvent.eventId = "demo-2026";
    const { result } = renderHook(() => useAdminOperationIdentity());

    expect(result.current).toEqual({
      eventId: "demo-2026",
      deviceId: "technical-scaffold",
      deviceToken: "demo-admin-device-token",
    });
  });
});
