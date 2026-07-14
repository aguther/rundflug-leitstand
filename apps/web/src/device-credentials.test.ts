import { describe, expect, it } from "vitest";
import {
  deviceCredentialCandidates,
  deviceCredentialToken,
  rememberDeviceCredential,
} from "./device-credentials";

function storageFixture(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("device credentials", () => {
  it("remembers a credential by device and by anonymous role", () => {
    const storage = storageFixture();

    rememberDeviceCredential(storage, "ADMIN", "admin-new", "synthetic-token");

    expect(storage.getItem("device-id:ADMIN")).toBe("admin-new");
    expect(deviceCredentialToken(storage, "ADMIN", "admin-new")).toBe("synthetic-token");
    expect(storage.getItem("device-role-token:ADMIN")).toBe("synthetic-token");
  });

  it("offers a former locally held token to repair an event clone binding", () => {
    const storage = storageFixture({
      "device-id:ADMIN": "admin-new",
      "device-token:admin-old": "synthetic-former-token",
    });

    expect(deviceCredentialCandidates(storage, "ADMIN", "admin-new")).toEqual([
      "synthetic-former-token",
    ]);
  });

  it("prefers the exact current credential and removes duplicate candidates", () => {
    const storage = storageFixture({
      "device-token:admin-new": "synthetic-current-token",
      "device-role-token:ADMIN": "synthetic-current-token",
      "device-token:admin-old": "synthetic-current-token",
    });

    expect(deviceCredentialCandidates(storage, "ADMIN", "admin-new")).toEqual([
      "synthetic-current-token",
    ]);
  });
});
