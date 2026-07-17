import { describe, expect, it } from "vitest";
import { clearedSessionCookie, sessionCookie, sessionTimes } from "./auth";

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

  it("gives displays a longer but still bounded session", () => {
    const now = new Date("2026-07-17T10:00:00.000Z");
    expect(Date.parse(sessionTimes("DISPLAY", now).absoluteExpiresAt)).toBeGreaterThan(
      Date.parse(sessionTimes("ADMIN", now).absoluteExpiresAt),
    );
  });
});
