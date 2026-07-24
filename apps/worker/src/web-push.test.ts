import { describe, expect, it, vi } from "vitest";
import type { Env } from "./types";
import {
  isAllowedPushEndpoint,
  publicPushPayload,
  publicPushTargetPath,
  purgeExpiredPushSubscriptions,
  pushDeleteAfter,
  pushMessageFor,
  pushRetentionDays,
  pushUrgencyFor,
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
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QD/synthetic")).toBe(true);
    expect(isAllowedPushEndpoint("https://example.invalid/internal")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.example.invalid/attack")).toBe(false);
  });

  it("erzeugt ausschließlich kanonische relative Ticket- und Gruppenpfade", () => {
    expect(
      publicPushTargetPath({
        targetKind: "TICKET",
        ticketCode: "ABCDEFGHJKLM",
        groupCode: "NPQRSTUVWXYZ2",
      }),
    ).toBe("/ticket/ABCDEFGHJKLM");
    expect(
      publicPushTargetPath({
        targetKind: "GROUP",
        ticketCode: "ABCDEFGHJKLM",
        groupCode: "NPQRSTUVWXYZ2",
      }),
    ).toBe("/gruppe/NPQRSTUVWXYZ2");
    expect(
      publicPushTargetPath({
        targetKind: "GROUP",
        ticketCode: "ABCDEFGHJKLM",
        groupCode: "../admin",
      }),
    ).toBeNull();
  });

  it("verwendet die freigegebene GO-TO-GATE-Copy", () => {
    expect(pushMessageFor("FLIGHT_GROUP_CALLED")).toBe("Bitte jetzt zum Gate kommen.");
    expect(pushMessageFor("ROTATION_STARTED")).toBe("Ihr Rundflug ist gestartet.");
    expect(pushUrgencyFor("FLIGHT_GROUP_CALLED")).toBe("high");
    expect(pushUrgencyFor("ROTATION_STARTED")).toBe("normal");
  });

  it("liefert einen deklarativen, service-worker-unabhängigen iOS-Payload", () => {
    const payload = JSON.parse(publicPushPayload("FLIGHT_GROUP_CALLED", "/gruppe/NPQRSTUVWXYZ2"));
    expect(payload).toEqual({
      web_push: 8030,
      notification: {
        title: "Rundflug-Leitstand",
        lang: "de",
        dir: "ltr",
        body: "Bitte jetzt zum Gate kommen.",
        navigate: "/gruppe/NPQRSTUVWXYZ2",
        data: { url: "/gruppe/NPQRSTUVWXYZ2" },
      },
    });
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
    predictionUpdatedAt: "2026-07-22T09:59:00.000Z",
    predictionUpperMinutes: 15,
    notificationLeadMinutes: 20,
    now: "2026-07-22T10:00:00.000Z",
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

  it("unterdrückt Vorbereitung bei einer mehr als fünf Minuten alten Prognose", () => {
    expect(
      shouldQueuePreparationNotification({
        ...eligible,
        predictionUpdatedAt: "2026-07-22T09:55:00.000Z",
      }),
    ).toBe(true);
    expect(
      shouldQueuePreparationNotification({
        ...eligible,
        predictionUpdatedAt: "2026-07-22T09:54:59.999Z",
      }),
    ).toBe(false);
    expect(shouldQueuePreparationNotification({ ...eligible, predictionUpdatedAt: null })).toBe(
      false,
    );
  });
});
