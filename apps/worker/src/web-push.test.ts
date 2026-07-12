import { describe, expect, it, vi } from "vitest";
import type { Env } from "./types";
import {
  isAllowedPushEndpoint,
  purgeExpiredPushSubscriptions,
  pushDeleteAfter,
  pushRetentionDays,
  shouldQueuePreparationNotification,
} from "./web-push";

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
  it("berechnet die konfigurierbare Löschfrist ab Veranstaltungsende", () => {
    expect(pushRetentionDays(undefined)).toBe(7);
    expect(pushRetentionDays("14")).toBe(14);
    expect(pushRetentionDays("0")).toBe(7);
    expect(pushRetentionDays("invalid")).toBe(7);
    expect(pushDeleteAfter("2026-07-12T18:00:00.000Z", 7)).toBe("2026-07-19T18:00:00.000Z");
    expect(() => pushDeleteAfter("invalid", 7)).toThrow(/Veranstaltungsende/);
  });

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

describe("prognosebasierte Web-Push-Vorbereitung", () => {
  const eligible = {
    emergencyMode: false,
    interrupted: false,
    status: "DRAFT",
    predictionQuality: "CHANGING",
    predictionUpperMinutes: 15,
    notificationLeadMinutes: 20,
  };

  it("verwendet die konfigurierte Vorlaufgrenze", () => {
    expect(shouldQueuePreparationNotification(eligible)).toBe(true);
    expect(shouldQueuePreparationNotification({ ...eligible, predictionUpperMinutes: 21 })).toBe(
      false,
    );
  });

  it("sendet bei unsicherem, unterbrochenem oder bereits aufgerufenem Betrieb nicht vorab", () => {
    expect(
      shouldQueuePreparationNotification({ ...eligible, predictionQuality: "UNCERTAIN" }),
    ).toBe(false);
    expect(shouldQueuePreparationNotification({ ...eligible, interrupted: true })).toBe(false);
    expect(shouldQueuePreparationNotification({ ...eligible, emergencyMode: true })).toBe(false);
    expect(shouldQueuePreparationNotification({ ...eligible, status: "CALLED" })).toBe(false);
  });
});
