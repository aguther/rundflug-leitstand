import { describe, expect, it, vi } from "vitest";
import type { Env } from "./types";
import { isAllowedPushEndpoint, purgeExpiredPushSubscriptions } from "./web-push";

describe("Web-Push-Endpunkte", () => {
  it("erlaubt Browser-Push-Dienste und blockiert beliebige Ziele", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/synthetic")).toBe(true);
    expect(
      isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/synthetic"),
    ).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=synthetic")).toBe(
      true,
    );
    expect(isAllowedPushEndpoint("https://example.invalid/internal")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.example.invalid/attack")).toBe(false);
  });
});

describe("Web-Push-Aufbewahrung", () => {
  it("löscht abgelaufene und widerrufene Ziele", async () => {
    const bind = vi
      .fn()
      .mockReturnValue({ run: vi.fn().mockResolvedValue({ meta: { changes: 3 } }) });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { DB: { prepare } } as unknown as Env;
    const deleted = await purgeExpiredPushSubscriptions(env, new Date("2026-07-18T12:00:00Z"));
    expect(deleted).toBe(3);
    expect(prepare).toHaveBeenCalledWith(
      "DELETE FROM web_push_subscriptions WHERE delete_after <= ?1 OR status <> 'ACTIVE'",
    );
    expect(bind).toHaveBeenCalledWith("2026-07-18T12:00:00.000Z");
  });
});
