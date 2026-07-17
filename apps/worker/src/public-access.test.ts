import { describe, expect, it, vi } from "vitest";
import {
  allowAdminDeviceRecoveryAttempt,
  allowLoginAttempt,
  allowUnknownTicketAttempt,
} from "./public-access";

describe("public ticket access", () => {
  it("limits unknown-ticket attempts per requesting actor without persisting the address", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const request = new Request("https://example.test/api/public/tickets/UNKNOWN", {
      headers: { "cf-connecting-ip": "192.0.2.10" },
    });

    await expect(allowUnknownTicketAttempt({ limit }, request)).resolves.toBe(false);
    const key = limit.mock.calls[0]?.[0].key as string;
    expect(key).toMatch(/^unknown-ticket:[a-f0-9]{64}$/);
    expect(key).not.toContain("192.0.2.10");
  });

  it("uses one conservative bucket when the edge actor header is unavailable", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });

    await expect(
      allowUnknownTicketAttempt({ limit }, new Request("https://example.test/status")),
    ).resolves.toBe(true);
    expect(limit.mock.calls[0]?.[0].key).toMatch(/^unknown-ticket:[a-f0-9]{64}$/);
  });
});

describe("operator login access", () => {
  it("combines account and edge actor without exposing either in the limiter key", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const request = new Request("https://example.test/api/auth/login", {
      headers: { "cf-connecting-ip": "192.0.2.40" },
    });
    await expect(allowLoginAttempt({ limit }, request, "account-secret-id")).resolves.toBe(true);
    const key = limit.mock.calls[0]?.[0].key as string;
    expect(key).toMatch(/^operator-login:[a-f0-9]{64}$/);
    expect(key).not.toContain("192.0.2.40");
    expect(key).not.toContain("account-secret-id");
  });
});

describe("administrator device recovery access", () => {
  it("rate-limits the edge actor even when device IDs are changed", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const request = new Request("https://example.test/api/admin/events/event/recover-device", {
      headers: { "cf-connecting-ip": "192.0.2.20" },
    });

    await expect(allowAdminDeviceRecoveryAttempt({ limit }, request)).resolves.toBe(true);
    const key = limit.mock.calls[0]?.[0].key as string;
    expect(key).toMatch(/^admin-device-recovery:[a-f0-9]{64}$/);
    expect(key).not.toContain("192.0.2.20");
  });
});
