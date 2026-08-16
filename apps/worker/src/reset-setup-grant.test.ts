import { describe, expect, it, vi } from "vitest";
import {
  clearedResetSetupCookie,
  installationRecoveryCode,
  resetSetupCookie,
  resetSetupGrantExpiry,
  resetSetupToken,
  validResetSetupGrant,
} from "./reset-setup-grant";
import type { Env } from "./types";

function envWith(overrides: Partial<Env> = {}): Env {
  return {
    APP_ENV: "acceptance",
    DATA_JURISDICTION: "eu",
    ADMIN_PIN_HASH: "a".repeat(64),
    INSTALLATION_RECOVERY_CODE: "offline-recovery-code-with-strong-entropy",
    RESET_SETUP_SIGNING_KEY: "reset-signing-key-with-strong-entropy",
    DB: {} as D1Database,
    BACKUPS: {} as R2Bucket,
    PUBLIC_TICKET_RATE_LIMITER: {} as RateLimit,
    ADMIN_RECOVERY_RATE_LIMITER: {} as RateLimit,
    EVENT_COORDINATOR: {} as Env["EVENT_COORDINATOR"],
    PLANNING_HISTORY_COMPACTION: {} as Env["PLANNING_HISTORY_COMPACTION"],
    ASSETS: {} as Fetcher,
    ...overrides,
  };
}

describe("reset setup grants", () => {
  it("derives a stable opaque token without exposing the signing key", async () => {
    const env = envWith();
    const first = await resetSetupToken(
      env,
      "550e8400-e29b-41d4-a716-446655440500",
      "2026-07-26T12:00:00.000Z",
    );
    const duplicate = await resetSetupToken(
      env,
      "550e8400-e29b-41d4-a716-446655440500",
      "2026-07-26T12:00:00.000Z",
    );
    expect(first).toBe(duplicate);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain("reset-signing");
  });

  it("uses a secure host cookie on HTTPS and a local-only fallback during development", () => {
    const secure = resetSetupCookie(
      "a".repeat(43),
      new Request("https://leitstand.example.test/reset"),
    );
    expect(secure).toContain("__Host-rls_reset_setup=");
    expect(secure).toContain("HttpOnly");
    expect(secure).toContain("SameSite=Strict");
    expect(secure).toContain("Secure");
    expect(secure).toContain("Max-Age=1800");

    const local = resetSetupCookie("a".repeat(43), new Request("http://localhost/setup"));
    expect(local).toContain("rls_reset_setup=");
    expect(local).not.toContain("; Secure");
    expect(clearedResetSetupCookie(new Request("http://localhost/setup"))).toContain("Max-Age=0");
  });

  it("recognizes only an unconsumed, unexpired hashed cookie grant", async () => {
    const first = vi.fn().mockResolvedValue({
      command_id: "reset-command",
      completed_at: "2026-07-26T12:00:00.000Z",
      setup_grant_expires_at: "2026-07-26T12:30:00.000Z",
    });
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });
    const request = new Request("https://leitstand.example.test/setup", {
      headers: {
        cookie: "__Host-rls_reset_setup=abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG",
      },
    });

    await expect(
      validResetSetupGrant(
        envWith({ DB: { prepare } as unknown as D1Database }),
        request,
        new Date("2026-07-26T12:05:00.000Z"),
      ),
    ).resolves.toMatchObject({ command_id: "reset-command" });
    expect(bind).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      "2026-07-26T12:05:00.000Z",
    );
  });

  it("keeps a legacy bootstrap secret as a one-release recovery fallback", () => {
    const legacyEnv = envWith({ BOOTSTRAP_TOKEN: "legacy-code" });
    delete legacyEnv.INSTALLATION_RECOVERY_CODE;
    expect(installationRecoveryCode(legacyEnv)).toBe("legacy-code");
    expect(resetSetupGrantExpiry(new Date("2026-07-26T12:00:00.000Z"))).toBe(
      "2026-07-26T12:30:00.000Z",
    );
  });
});
