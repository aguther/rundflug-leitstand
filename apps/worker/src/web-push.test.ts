import { describe, expect, it, vi } from "vitest";
import type { Env } from "./types";
import {
  isAllowedPushEndpoint,
  type PushNotificationContext,
  publicPushNavigateOrigin,
  publicPushPayload,
  publicPushTargetPath,
  purgeExpiredPushSubscriptions,
  pushDeleteAfter,
  pushErrorMessage,
  pushNotificationFor,
  pushRetentionDays,
  pushUrgencyFor,
  shouldQueuePreparationNotification,
  vapidConfiguration,
} from "./web-push";
import pushSource from "./web-push.ts?raw";

describe("Web-Push-Endpunkte", () => {
  const pushContext = (
    notificationType: PushNotificationContext["notificationType"],
    bookingGroupPart: PushNotificationContext["bookingGroupPart"] = {
      partNumber: 1,
      partCount: 1,
      passengerCount: 5,
    },
  ): PushNotificationContext => ({
    notificationType,
    gateLabel: "Flight Line 1",
    bookingGroupLabel: "G-PAN-0101",
    bookingGroupPart,
  });

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

  it("trennt ortsbezogene Push-Titel und -Texte mit dem konkreten Gate", () => {
    expect(pushNotificationFor(pushContext("PREPARE_FOR_FLIGHT"))).toEqual({
      title: "Bitte bereithalten",
      body: "Ihr Aufruf steht bevor. Bitte halten Sie sich in der Nähe von Gate „Flight Line 1“ bereit.",
    });
    expect(pushNotificationFor(pushContext("GO_TO_GATE"))).toEqual({
      title: "Bitte zum Gate",
      body: "Bitte kommen Sie jetzt zum Gate „Flight Line 1“ und warten Sie dort auf den Boardingaufruf.",
    });
    expect(pushNotificationFor(pushContext("BOARDING_STARTED"))).toEqual({
      title: "Boarding hat begonnen",
      body: "Das Boarding am Gate „Flight Line 1“ hat begonnen. Bitte halten Sie Ihr Ticket für den Einstieg bereit.",
    });
    expect(pushUrgencyFor("GO_TO_GATE")).toBe("high");
    expect(pushUrgencyFor("BOARDING_STARTED")).toBe("high");
    expect(pushUrgencyFor("ROTATION_STARTED")).toBe("normal");
    expect(
      pushNotificationFor({
        ...pushContext("TICKET_GROUP_RECALL", {
          partNumber: 2,
          partCount: 2,
          passengerCount: 2,
        }),
        gateLabel: "Gate 2",
        bookingGroupLabel: "PAN20-042",
      }),
    ).toEqual({
      title: "Erneuter Aufruf",
      body: "Ihre Gruppe PAN20-042 wird erneut aufgerufen. Bitte kommen Sie jetzt zu Gate 2.",
    });
    expect(pushUrgencyFor("TICKET_GROUP_RECALL")).toBe("high");
  });

  it("verwendet für spätere Umlaufphasen die freigegebenen Titel und Beschreibungen", () => {
    expect(pushNotificationFor(pushContext("ROTATION_STARTED"))).toEqual({
      title: "Rundflug gestartet",
      body: "Ihr Rundflug ist gestartet.",
    });
    expect(pushNotificationFor(pushContext("ROTATION_LANDED"))).toEqual({
      title: "Rundflug gelandet",
      body: "Ihr Rundflug ist gelandet.",
    });
    expect(pushNotificationFor(pushContext("ROTATION_COMPLETED"))).toEqual({
      title: "Rundflug abgeschlossen",
      body: "Ihr Rundflug ist abgeschlossen. Vielen Dank fürs Mitfliegen!",
    });
  });

  it.each([
    ["PREPARE_FOR_FLIGHT", "Bitte bereithalten"],
    ["GO_TO_GATE", "Bitte zum Gate"],
    ["BOARDING_STARTED", "Boarding hat begonnen"],
    ["ROTATION_STARTED", "Rundflug gestartet"],
    ["ROTATION_LANDED", "Rundflug gelandet"],
    ["ROTATION_COMPLETED", "Rundflug abgeschlossen"],
  ] as const)(
    "prefixes %s with the canonical booking group part label",
    (notificationType, title) => {
      const firstPart = pushNotificationFor(
        pushContext(notificationType, { partNumber: 1, partCount: 2, passengerCount: 3 }),
      );
      const secondPart = pushNotificationFor(
        pushContext(notificationType, { partNumber: 2, partCount: 2, passengerCount: 2 }),
      );

      expect(firstPart.title).toBe(`Teilflug 1/2 · ${title}`);
      expect(firstPart.body).toMatch(/^Teilflug 1 von 2 der Gruppe G-PAN-0101: /);
      expect(secondPart.title).toBe(`Teilflug 2/2 · ${title}`);
      expect(secondPart.body).toMatch(/^Teilflug 2 von 2 der Gruppe G-PAN-0101: /);
    },
  );

  it("ermittelt das öffentliche Gate aus Umlauf oder Produkt ohne Gastdaten im Payload", () => {
    expect(pushSource).toContain("g.label AS gate_label");
    expect(pushSource).toContain("JOIN gates g ON g.id = COALESCE(r.gate_id, p.gate_id)");
    expect(pushSource).not.toMatch(/guest_name|passenger_name|phone_number/i);
  });

  it("liefert einen deklarativen, service-worker-unabhängigen iOS-Payload", () => {
    const payload = JSON.parse(
      publicPushPayload({
        ...pushContext("GO_TO_GATE", { partNumber: 1, partCount: 2, passengerCount: 3 }),
        targetPath: "/gruppe/NPQRSTUVWXYZ2",
        origin: "https://status.example",
      }),
    );
    expect(payload).toEqual({
      web_push: 8030,
      notification: {
        title: "Teilflug 1/2 · Bitte zum Gate",
        lang: "de",
        dir: "ltr",
        body: "Teilflug 1 von 2 der Gruppe G-PAN-0101: Bitte kommen Sie jetzt zum Gate „Flight Line 1“ und warten Sie dort auf den Boardingaufruf.",
        navigate: "https://status.example/gruppe/NPQRSTUVWXYZ2",
        data: { url: "/gruppe/NPQRSTUVWXYZ2" },
      },
    });
  });

  it("akzeptiert als Navigationsziel nur einen absoluten HTTPS-Ursprung", () => {
    expect(publicPushNavigateOrigin("https://status.example")).toBe("https://status.example");
    expect(publicPushNavigateOrigin("https://status.example:8443")).toBe(
      "https://status.example:8443",
    );
    expect(publicPushNavigateOrigin("http://localhost:8787")).toBeNull();
    expect(publicPushNavigateOrigin("https://status.example/gruppe")).toBeNull();
    expect(publicPushNavigateOrigin("/gruppe/NPQRSTUVWXYZ2")).toBeNull();
    expect(publicPushNavigateOrigin(null)).toBeNull();
  });

  it("fällt ohne bekannten Ursprung auf den Service-Worker-Payload zurück", () => {
    const payload = JSON.parse(
      publicPushPayload({
        ...pushContext("BOARDING_STARTED", {
          partNumber: 2,
          partCount: 2,
          passengerCount: 2,
        }),
        targetPath: "/gruppe/NPQRSTUVWXYZ2",
        origin: null,
      }),
    );
    expect(payload).toEqual({
      title: "Teilflug 2/2 · Boarding hat begonnen",
      lang: "de",
      dir: "ltr",
      body: "Teilflug 2 von 2 der Gruppe G-PAN-0101: Das Boarding am Gate „Flight Line 1“ hat begonnen. Bitte halten Sie Ihr Ticket für den Einstieg bereit.",
      data: { url: "/gruppe/NPQRSTUVWXYZ2" },
    });
    expect(payload.web_push).toBeUndefined();
    expect(payload.navigate).toBeUndefined();
  });

  it("keeps declarative iOS and service-worker payload copy identical", () => {
    const context = {
      ...pushContext("GO_TO_GATE", { partNumber: 2, partCount: 2, passengerCount: 2 }),
      targetPath: "/gruppe/NPQRSTUVWXYZ2",
    };
    const declarative = JSON.parse(
      publicPushPayload({ ...context, origin: "https://status.example" }),
    );
    const fallback = JSON.parse(publicPushPayload({ ...context, origin: null }));

    expect({ title: declarative.notification.title, body: declarative.notification.body }).toEqual({
      title: fallback.title,
      body: fallback.body,
    });
  });
});

describe("Web-Push-Konfiguration", () => {
  const configuredEnv = (
    overrides: Partial<
      Record<"VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT", string | undefined>
    > = {},
  ) =>
    ({
      VAPID_PUBLIC_KEY: "public",
      VAPID_PRIVATE_KEY: "private",
      VAPID_SUBJECT: "mailto:betrieb@example.invalid",
      ...overrides,
    }) as unknown as Env;

  it("gilt erst mit Schlüsselpaar und Betreiberkontakt als betriebsbereit", () => {
    expect(vapidConfiguration(configuredEnv())).toEqual({
      publicKey: "public",
      privateKey: "private",
      subject: "mailto:betrieb@example.invalid",
    });
    expect(vapidConfiguration(configuredEnv({ VAPID_PRIVATE_KEY: undefined }))).toBeNull();
    expect(vapidConfiguration(configuredEnv({ VAPID_SUBJECT: undefined }))).toBeNull();
    expect(vapidConfiguration(configuredEnv({ VAPID_PUBLIC_KEY: undefined }))).toBeNull();
  });

  it("hält Push-Endpunkte aus Fehlerprotokollen heraus", () => {
    expect(pushErrorMessage(new Error("Invalid URL: https://web.push.apple.com/QIs0Rgeheim"))).toBe(
      "Invalid URL: [endpunkt]",
    );
    expect(pushErrorMessage(new Error("Web-Push-TTL ist ungültig."))).toBe(
      "Web-Push-TTL ist ungültig.",
    );
    expect(pushErrorMessage("kein Fehlerobjekt")).toBe("Unbekannter Fehler");
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
