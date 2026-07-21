import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertOperationalConnection,
  controlApiPath,
  factoryReset,
  getHealth,
  getOperationBoard,
  getPushConfiguration,
  sendCommand,
  verifyAdminPin,
} from "./api";
import apiSource from "./api.ts?raw";
import operationWorkspaceSource from "./operation-workspace.tsx?raw";

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
  it("replaces a complete transport failure with actionable guidance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(getHealth()).rejects.toThrowError(
      "Server nicht erreichbar. Bitte Verbindung prüfen und die Seite neu laden.",
    );
  });

  it("[T-020] retries a failed same-origin GET through WebKit's XHR transport", async () => {
    class SuccessfulXmlHttpRequest {
      status = 200;
      statusText = "OK";
      responseText = JSON.stringify({
        ok: true,
        service: "Rundflug-Leitstand",
        applicationVersion: "1.7.0",
        environment: "production",
        requirementsVersion: "1.7.0",
        timestamp: "2026-07-18T12:00:00.000Z",
      });
      private listeners = new Map<string, () => void>();

      open() {}
      setRequestHeader() {}
      getResponseHeader(name: string) {
        return name.toLowerCase() === "content-type" ? "application/json" : null;
      }
      addEventListener(name: string, listener: () => void) {
        this.listeners.set(name, listener);
      }
      send() {
        this.listeners.get("load")?.();
      }
      abort() {
        this.listeners.get("abort")?.();
      }
      withCredentials = false;
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Load failed")));
    vi.stubGlobal("XMLHttpRequest", SuccessfulXmlHttpRequest);

    await expect(getHealth()).resolves.toMatchObject({ ok: true, environment: "production" });
  });
});

describe("content-blocker-neutral operational routing", () => {
  it("[T-020] keeps every browser-side private event request off the blocked /api/event prefix", () => {
    const easyPrivacyWorkerRule = /^https?:\/\/[^/]*workers\.dev\/api\/event/i;
    const workerOrigin = "https://rundflug-leitstand.synthetic.workers.dev";

    expect(`${workerOrigin}${controlApiPath("synthetic event", "/operations")}`).toBe(
      `${workerOrigin}/api/control/synthetic%20event/operations`,
    );
    expect(`${workerOrigin}${controlApiPath("synthetic event", "/operations")}`).not.toMatch(
      easyPrivacyWorkerRule,
    );
    expect(`${workerOrigin}/api/events/synthetic-event/operations`).toMatch(easyPrivacyWorkerRule);
    expect(apiSource).not.toContain("/api/events/");
    expect(operationWorkspaceSource).toContain("/api/control/");
    expect(operationWorkspaceSource).not.toContain("/api/public/events/");
  });
});

describe("session-only browser transport", () => {
  it("does not send the browser's legacy device ID or token with a production command", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "synthetic rejection" } }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: true });

    await expect(
      sendCommand(
        {
          commandId: "550e8400-e29b-41d4-a716-446655440001",
          eventId: "synthetic-event",
          deviceId: "browser-controlled-device",
          expectedVersion: 1,
          issuedAt: "2026-07-18T12:00:00.000Z",
          type: "SET_OPERATIONAL_NOTE",
          payload: { note: "Synthetischer Hinweis" },
        },
        "browser-controlled-token",
      ),
    ).rejects.toThrowError("synthetic rejection");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).not.toHaveProperty("deviceId");
  });

  it("[T-020] sends an operation-board request without device headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getOperationBoard("synthetic-event", "ignored-browser-device", "ignored-device-token"),
    ).rejects.toThrowError("Betriebsdaten nicht verfügbar (503)");

    expect(fetchMock).toHaveBeenCalledWith("/api/control/synthetic-event/operations", {});
  });

  it("authenticates factory reset only through the HttpOnly session cookie", async () => {
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
      factoryReset("synthetic-event", "ignored-device", "ignored-token", {
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
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("verifies an administrator PIN without a client device identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyAdminPin("synthetic-event", "ignored-device", "ignored-token", "0000"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/synthetic-event/verify-pin",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminPin: "0000" }),
      }),
    );
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
