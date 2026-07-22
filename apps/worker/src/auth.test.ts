import { describe, expect, it } from "vitest";
import { clearedSessionCookie, operatorRoles, sessionCookie, sessionTimes } from "./auth";

describe("operator sessions", () => {
  it("uses an HttpOnly strict secure cookie on HTTPS", () => {
    const cookie = sessionCookie("secret-token", new Request("https://example.test/login"), 60);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=60");
  });

  it("clears the session without exposing a reusable value", () => {
    expect(clearedSessionCookie(new Request("https://example.test/logout"))).toContain("Max-Age=0");
  });

  it("expires every internal session exactly after 16 hours", () => {
    const now = new Date("2026-07-17T10:00:00.000Z");
    const times = sessionTimes("ADMIN", now);
    expect(times.absoluteExpiresAt).toBe("2026-07-18T02:00:00.000Z");
    expect(times.idleExpiresAt).toBe(times.absoluteExpiresAt);
  });

  it("keeps DISPLAY sessions for 90 days without an earlier idle expiry", () => {
    expect(operatorRoles).toContain("DISPLAY");
    const now = new Date("2026-07-17T10:00:00.000Z");
    const times = sessionTimes("DISPLAY", now);
    expect(times.absoluteExpiresAt).toBe("2026-10-15T10:00:00.000Z");
    expect(times.idleExpiresAt).toBe(times.absoluteExpiresAt);
    expect(times.maxAgeSeconds).toBe(90 * 24 * 60 * 60);
  });
});
