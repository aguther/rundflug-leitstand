import { afterEach, describe, expect, it, vi } from "vitest";
import { assertOperationalConnection, getDeviceContext } from "./api";

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
