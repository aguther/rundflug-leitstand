import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertOperationalConnection,
  factoryReset,
  getDeviceContext,
  getHealth,
  getPushConfiguration,
  verifyAdminPin,
} from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("operational command connection policy", () => {
  it("rejects operative commands without a server connection", () => {
    expect(() => assertOperationalConnection(false)).toThrowError(
      "Offline: operative Aktion benötigt eine Serverbestätigung.",
    );
  });

  it("allows the command transport only while online", () => {
    expect(() => assertOperationalConnection(true)).not.toThrow();
  });
});

describe("network failure guidance", () => {
  it("replaces the browser-specific fetch error with an actionable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(getHealth()).rejects.toThrowError(
      "Server nicht erreichbar. Bitte Verbindung prüfen und die Seite neu laden.",
    );
  });
});

describe("paired device context recovery", () => {
  it("recovers the event id without exposing the device token in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ eventId: "rundflug-2026", role: "ADMIN" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDeviceContext("synthetic-device", "synthetic-secret-token")).resolves.toEqual({
      eventId: "rundflug-2026",
      role: "ADMIN",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/device/context", {
      headers: {
        "x-device-id": "synthetic-device",
        "x-device-token": "synthetic-secret-token",
      },
    });
  });
});

describe("factory reset transport", () => {
  it("authenticates the destructive request without putting credentials in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          resetComplete: true,
          setupRequired: true,
          recoveryBackupKey: "backups/synthetic.json",
          r2BackupsDeleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      factoryReset("synthetic-event", "synthetic-admin", "synthetic-token", {
        commandId: "550e8400-e29b-41d4-a716-446655440500",
        eventId: "synthetic-event",
        reason: "Entwicklungsstand neu aufbauen",
        adminPin: "0000",
        confirmation: "WERKSZUSTAND",
        retainRecoveryBackup: true,
        deleteAllBackups: false,
      }),
    ).resolves.toMatchObject({ resetComplete: true, setupRequired: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/synthetic-event/factory-reset",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-device-id": "synthetic-admin",
          "x-device-token": "synthetic-token",
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("synthetic-token");
  });
});

describe("administrator edit mode transport", () => {
  it("verifies the PIN with paired-device authentication and no URL credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyAdminPin("synthetic-event", "synthetic-admin", "synthetic-token", "0000"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/synthetic-event/verify-pin",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-device-id": "synthetic-admin",
          "x-device-token": "synthetic-token",
        }),
        body: JSON.stringify({ adminPin: "0000" }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("0000");
  });
});

describe("web push configuration status", () => {
  it("distinguishes missing Cloudflare secrets from zero active subscriptions", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: "PUSH_NOT_CONFIGURED" } }), { status: 503 }),
        ),
    );

    await expect(getPushConfiguration()).resolves.toEqual({ configured: false });
  });

  it("returns a validated configured state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ publicKey: "A".repeat(87), retentionDays: 7 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(getPushConfiguration()).resolves.toEqual({
      configured: true,
      publicKey: "A".repeat(87),
      retentionDays: 7,
    });
  });
});
