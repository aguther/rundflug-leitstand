import { describe, expect, it } from "vitest";
import {
  clearedSessionCookie,
  operatorRoles,
  sessionBrowserBindingHash,
  sessionCookie,
  sessionTimes,
} from "./auth";

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

  it("binds reset retries to the original HttpOnly browser session", async () => {
    const original = new Request("https://example.test/reset", {
      headers: { cookie: `rls_session=${"a".repeat(48)}` },
    });
    const otherBrowser = new Request("https://example.test/reset", {
      headers: { cookie: `rls_session=${"b".repeat(48)}` },
    });

    await expect(sessionBrowserBindingHash(original)).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(await sessionBrowserBindingHash(original)).not.toBe(
      await sessionBrowserBindingHash(otherBrowser),
    );
    await expect(
      sessionBrowserBindingHash(new Request("https://example.test/reset")),
    ).resolves.toBeNull();
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
