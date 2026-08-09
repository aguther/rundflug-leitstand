import { describe, expect, it, vi } from "vitest";
import pushWorker from "../../web/public/push-sw.js?raw";
import publicStatusCopy from "./public-status-copy.ts?raw";

describe("öffentlicher Status V1.8", () => {
  it("trennt GO-TO-GATE- und BOARDING-Copy exakt", () => {
    expect(publicStatusCopy).toContain(
      '"Bitte kommen Sie jetzt zum Gate und warten Sie dort auf den Boardingaufruf."',
    );
    expect(publicStatusCopy).toContain(
      '"Das Boarding hat begonnen. Bitte halten Sie Ihr Ticket für den Einstieg bereit."',
    );
    expect(publicStatusCopy).not.toContain('"Bitte jetzt zur Flight Line kommen."');
    expect(publicStatusCopy).not.toContain('"Bitte jetzt zum angegebenen Gate kommen."');
  });

  it("öffnet aus Push ausschließlich validierte Statuspfade des eigenen Ursprungs", () => {
    expect(pushWorker).toContain("^\\/(?:ticket|gruppe)\\/");
    expect(pushWorker).toContain("safePublicStatusPath");
    expect(pushWorker).toContain("target.origin !== self.location.origin");
    expect(pushWorker).toContain("data?.web_push === 8030");
    expect(pushWorker).toContain("notification?.navigate");
    expect(pushWorker).toContain("self.clients.openWindow(targetPath)");
    expect(pushWorker).not.toContain('openWindow(event.notification.data?.url ?? "/")');
    expect(pushWorker).not.toContain('tag: "rundflug-ticket-status"');
  });

  it("zeigt deklarative Push-Daten auch in Browsern ohne nativen Fallback sichtbar an", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const serviceWorker = {
      PUBLIC_STATUS_PATH: undefined,
      location: { origin: "https://status.example" },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners.set(type, listener);
      },
      registration: { showNotification },
      clients: {
        matchAll: vi.fn().mockResolvedValue([]),
        openWindow: vi.fn().mockResolvedValue(undefined),
      },
    };
    new Function("self", pushWorker)(serviceWorker);
    let notificationWork: Promise<unknown> | undefined;
    const pushListener = listeners.get("push") as (event: {
      data: { json(): unknown };
      waitUntil(work: Promise<unknown>): void;
    }) => void;
    pushListener({
      data: {
        json: () => ({
          web_push: 8030,
          notification: {
            title: "Teilflug 1/2 · Bitte zum Gate",
            body: "Teilflug 1 von 2 der Gruppe G-PAN-0101: Bitte kommen Sie jetzt zum Gate „Flight Line 1“ und warten Sie dort auf den Boardingaufruf.",
            navigate: "https://status.example/gruppe/NPQRSTUVWXYZ2",
          },
        }),
      },
      waitUntil: (work) => {
        notificationWork = work;
      },
    });
    await notificationWork;

    expect(showNotification).toHaveBeenCalledWith("Teilflug 1/2 · Bitte zum Gate", {
      body: "Teilflug 1 von 2 der Gruppe G-PAN-0101: Bitte kommen Sie jetzt zum Gate „Flight Line 1“ und warten Sie dort auf den Boardingaufruf.",
      data: { url: "/gruppe/NPQRSTUVWXYZ2" },
      lang: "de",
    });
  });

  it("hebt eine Einwilligung ohne Zutun des Gastes auf ein erneuertes Push-Ziel", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const renewed = {
      endpoint: "https://web.push.apple.com/neu",
      toJSON: () => ({
        endpoint: "https://web.push.apple.com/neu",
        keys: { p256dh: "neuer-schluessel", auth: "neuer-auth" },
      }),
    };
    const fetchMock = vi.fn(async (path: string) =>
      path === "/api/public/push/config"
        ? { ok: true, json: async () => ({ publicKey: "vapid-public-key", retentionDays: 7 }) }
        : { ok: true, json: async () => ({ active: true }) },
    );
    const serviceWorker = {
      PUBLIC_STATUS_PATH: undefined,
      location: { origin: "https://status.example" },
      fetch: fetchMock,
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners.set(type, listener);
      },
      registration: {
        showNotification: vi.fn(),
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(null),
          subscribe: vi.fn().mockResolvedValue(renewed),
        },
      },
      clients: { matchAll: vi.fn(), openWindow: vi.fn() },
    };
    new Function("self", pushWorker)(serviceWorker);
    let renewal: Promise<unknown> | undefined;
    const changeListener = listeners.get("pushsubscriptionchange") as (event: {
      oldSubscription: { endpoint: string };
      newSubscription: null;
      waitUntil(work: Promise<unknown>): void;
    }) => void;
    changeListener({
      oldSubscription: { endpoint: "https://web.push.apple.com/alt" },
      newSubscription: null,
      waitUntil: (work) => {
        renewal = work;
      },
    });
    await renewal;

    expect(serviceWorker.registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: "vapid-public-key",
    });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/public/push/subscriptions/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        previousEndpoint: "https://web.push.apple.com/alt",
        endpoint: "https://web.push.apple.com/neu",
        keys: { p256dh: "neuer-schluessel", auth: "neuer-auth" },
      }),
    });
  });
});
