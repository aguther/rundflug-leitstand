// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireDispatchRecommendationLease,
  bootstrapSystem,
  claimFlightLineAircraft,
  cloneEvent,
  deleteEvent,
  downloadDailyPdf,
  downloadDailyReport,
  downloadPerformanceProfile,
  downloadTicketRawData,
  type FlightLineAssistClaimConflictError,
  getPushPublicKey,
  getSetupStatus,
  registerGroupPush,
  registerTicketPush,
  releaseDispatchRecommendationLease,
  releaseFlightLineAircraft,
  removeEventLogo,
  revokeGroupPush,
  revokeTicketPush,
  uploadEventLogo,
} from "./api";

const syntheticClaim = {
  aircraftId: "aircraft-a",
  claimedByCurrentOperator: true,
  ownerLoginCode: "FL-SYNTHETIC",
  revision: 2,
  claimedAt: "2026-08-11T09:00:00.000Z",
  expiresAt: "2026-08-11T09:05:00.000Z",
};

const syntheticLease = {
  leaseId: "550e8400-e29b-41d4-a716-446655440101",
  aircraftId: "aircraft-a",
  planRevision: "plan-7",
  batchId: "batch-a",
  dispatchOrder: 1,
  groupIds: ["group-a"],
  occupiedSeats: 3,
  availableSeats: 1,
  decisionReasons: ["FIFO"],
  acquiredAt: "2026-08-11T09:00:00.000Z",
  expiresAt: "2026-08-11T09:01:00.000Z",
  serverNow: "2026-08-11T09:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => "550e8400-e29b-41d4-a716-446655440001"),
  });
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("API setup and event lifecycle", () => {
  it("preserves session-only requests across setup, cloning, deletion and logo changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/setup/status") {
        return jsonResponse({
          setupRequired: false,
          setupConfigured: true,
          resetSetupAuthorized: false,
          resetSetupExpiresAt: null,
        });
      }
      if (path === "/api/setup") return jsonResponse({ eventId: "event-created" });
      if (path.endsWith("/clone")) {
        return jsonResponse({ eventId: "event-clone", templateSourceId: "event-source" });
      }
      if (path === "/api/admin/events/event-clone" && init?.method === "DELETE") {
        return jsonResponse({
          deleted: true,
          eventId: "event-clone",
          setupRequired: false,
          assetCleanupPending: true,
        });
      }
      if (path.endsWith("/logo?theme=light") && init?.method === "PUT") {
        return jsonResponse({ logoUrl: "/assets/logo-light", theme: "light" });
      }
      if (path.endsWith("/logo?theme=light") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ error: { message: `Unexpected request ${path}` } }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSetupStatus()).resolves.toMatchObject({ setupConfigured: true });
    await expect(bootstrapSystem({} as never)).resolves.toEqual({ eventId: "event-created" });
    await expect(
      cloneEvent("event-source", "ignored-device", "ignored-token", {} as never),
    ).resolves.toEqual({ eventId: "event-clone", templateSourceId: "event-source" });
    await expect(
      deleteEvent(
        "event-source",
        "event-clone",
        8,
        "ignored-device",
        "ignored-token",
        "Synthetic cleanup",
      ),
    ).resolves.toMatchObject({ deleted: true, assetCleanupPending: true });
    const file = new File(["synthetic-logo"], "logo.svg", { type: "image/svg+xml" });
    await expect(
      uploadEventLogo("event-source", "ignored-device", "ignored-token", 8, "light", file),
    ).resolves.toEqual({ logoUrl: "/assets/logo-light", theme: "light" });
    await expect(
      removeEventLogo("event-source", "ignored-device", "ignored-token", 9, "light"),
    ).resolves.toBeUndefined();

    const deleteRequest = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === "/api/admin/events/event-clone" && init?.method === "DELETE",
    );
    expect(deleteRequest?.[1]?.headers).toEqual({
      "content-type": "application/json",
      "x-event-id": "event-source",
    });
    expect(JSON.parse(String(deleteRequest?.[1]?.body))).toEqual({
      commandId: "550e8400-e29b-41d4-a716-446655440001",
      expectedVersion: 8,
      confirmation: "event-clone",
      reason: "Synthetic cleanup",
    });
  });

  it("surfaces server validation messages for incomplete lifecycle responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: "Synthetische Validierung fehlgeschlagen" } }, 400),
        ),
    );

    await expect(bootstrapSystem({} as never)).rejects.toThrow(
      "Synthetische Validierung fehlgeschlagen",
    );
  });
});

describe("flight-line assist and dispatch leases", () => {
  it("preserves claim conflicts and validates successful claim and lease responses", async () => {
    const conflictingClaim = { ...syntheticClaim, claimedByCurrentOperator: false };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { claim: conflictingClaim, error: { message: "Bereits durch FL-02 betreut" } },
          409,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(syntheticClaim))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(syntheticLease))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      claimFlightLineAircraft("event-a", "aircraft-a", "ignored-device", "ignored-token"),
    ).rejects.toMatchObject({
      name: "FlightLineAssistClaimConflictError",
      message: "Bereits durch FL-02 betreut",
      claim: conflictingClaim,
    } satisfies Partial<FlightLineAssistClaimConflictError>);
    await expect(
      claimFlightLineAircraft("event-a", "aircraft-a", "ignored-device", "ignored-token", 2),
    ).resolves.toEqual(syntheticClaim);
    await expect(
      releaseFlightLineAircraft("event-a", "aircraft-a", "ignored-device", "ignored-token"),
    ).resolves.toBeUndefined();
    await expect(
      acquireDispatchRecommendationLease("event-a", "ignored-device", "ignored-token", {
        commandId: "550e8400-e29b-41d4-a716-446655440001",
        aircraftId: "aircraft-a",
        expectedVersion: 8,
      }),
    ).resolves.toEqual(syntheticLease);
    await expect(
      releaseDispatchRecommendationLease(
        "event-a",
        syntheticLease.leaseId,
        "ignored-device",
        "ignored-token",
      ),
    ).resolves.toBeUndefined();

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      action: "ACQUIRE_OR_RENEW",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      action: "TAKEOVER",
      expectedRevision: 2,
    });
  });
});

describe("API downloads", () => {
  it("downloads protected reports and always revokes generated object URLs", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("synthetic export", {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:synthetic-export");
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await downloadDailyReport("event-a", "ignored-device", "ignored-token");
    await downloadDailyPdf("event-a", "ignored-device", "ignored-token");
    await downloadTicketRawData("event-a", "ignored-device", "ignored-token");
    await downloadPerformanceProfile("event-a", "ignored-device", "ignored-token");

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/control/event-a/reports/daily.csv",
      "/api/control/event-a/reports/daily.pdf",
      "/api/control/event-a/exports/tickets.csv",
      "/api/control/event-a/exports/performance-profile.json",
    ]);
    expect(click).toHaveBeenCalledTimes(4);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
  });
});

describe("public push lifecycle", () => {
  it("uses consent-bearing subscriptions and endpoint-only revocation for tickets and groups", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ publicKey: "A".repeat(87), retentionDays: 7 }))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const subscription = {
      toJSON: () => ({
        endpoint: "https://push.synthetic/subscription",
        expirationTime: null,
        keys: { auth: "synthetic-auth", p256dh: "synthetic-key" },
      }),
    } as unknown as PushSubscription;

    await expect(getPushPublicKey()).resolves.toBe("A".repeat(87));
    await registerTicketPush("ticket code", subscription);
    await revokeTicketPush("ticket code", "https://push.synthetic/subscription");
    await registerGroupPush("group code", subscription);
    await revokeGroupPush("group code", "https://push.synthetic/subscription");

    expect(fetchMock.mock.calls.slice(1).map(([path, init]) => [path, init?.method])).toEqual([
      ["/api/public/tickets/ticket%20code/push-subscriptions", "POST"],
      ["/api/public/tickets/ticket%20code/push-subscriptions", "DELETE"],
      ["/api/public/groups/group%20code/push-subscriptions", "POST"],
      ["/api/public/groups/group%20code/push-subscriptions", "DELETE"],
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      consent: true,
      endpoint: "https://push.synthetic/subscription",
      expirationTime: null,
      keys: { auth: "synthetic-auth", p256dh: "synthetic-key" },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      endpoint: "https://push.synthetic/subscription",
    });
  });
});
