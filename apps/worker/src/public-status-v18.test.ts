import { describe, expect, it, vi } from "vitest";
import pushWorker from "../../web/public/push-sw.js?raw";
import worker from "./index.ts?raw";

describe("öffentlicher Status V1.8", () => {
  it("liefert Eventname und dieselbe Pausenlogik für Ticket und Gruppe", () => {
    expect(worker).toContain("eventName: row.event_name");
    expect(worker).toMatch(
      /row\.emergency_mode === 1 \|\|\s*row\.operational_interrupted === 1 \|\|\s*row\.resource_group_status !== "ACTIVE"\s*\? "SERVICE_PAUSED"/,
    );
  });

  it("trennt GO-TO-GATE- und BOARDING-Copy exakt", () => {
    expect(worker).toContain('"Bitte jetzt zum Gate kommen."');
    expect(worker).toContain('"Bitte am Gate zum Einstieg bereithalten."');
    expect(worker).not.toContain('"Bitte jetzt zur Flight Line kommen."');
    expect(worker).not.toContain('"Bitte jetzt zum angegebenen Gate kommen."');
  });

  it("leitet BOARDING für Ticket und Buchungsgruppe aus CALLED statt Anwesenheit ab", () => {
    const ticketHandler = worker.slice(
      worker.indexOf('app.get("/api/public/tickets/:ticketCode"'),
      worker.indexOf('app.get("/api/public/groups/:groupCode"'),
    );
    const groupHandler = worker.slice(
      worker.indexOf('app.get("/api/public/groups/:groupCode"'),
      worker.indexOf('app.get("/api/public/push/config"'),
    );

    expect(ticketHandler).toContain("derivePublicRotationStatus({");
    expect(ticketHandler).not.toContain("attendance_status");
    expect(groupHandler).toContain("derivePublicRotationStatus({");
    expect(groupHandler).not.toContain("present_count");
  });

  it("liefert ein installationsfähiges Manifest für den exakten Statuspfad", () => {
    expect(worker).toContain('app.get("/api/public/pwa-manifest/:target/:code"');
    expect(worker).toContain("id: targetPath");
    expect(worker).toContain("start_url: targetPath");
    expect(worker).toContain('scope: "/"');
    expect(worker).toContain('display: "standalone"');
    expect(worker).toContain("publicStatusInstallTitle");
    expect(worker).toContain("name: installTitle");
    expect(worker).toContain("short_name: installTitle");
    expect(worker).toContain("/icons/ticket-icon-512.png");
  });

  it("liefert schon im ersten HTML-Dokument seitenspezifische Installationsmetadaten", () => {
    expect(worker).toContain("installableAppShellResponse");
    expect(worker).toContain("new HTMLRewriter()");
    expect(worker).toMatch(/manifestHref: `\/api\/public\/pwa-manifest\/\$\{target\}\/\$\{code\}`/);
    expect(worker).toContain('appleTouchIconHref: "/icons/ticket-icon-180.png"');
    expect(worker).toMatch(/title: `\$\{installTitle\} · Rundflug`/);
  });

  it("öffnet aus Push ausschließlich validierte relative Statuspfade", () => {
    expect(pushWorker).toContain("^\\/(?:ticket|gruppe)\\/");
    expect(pushWorker).toContain("safePublicStatusPath");
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
            title: "Rundflug-Leitstand",
            body: "Bitte jetzt zum Gate kommen.",
            navigate: "/gruppe/NPQRSTUVWXYZ2",
          },
        }),
      },
      waitUntil: (work) => {
        notificationWork = work;
      },
    });
    await notificationWork;

    expect(showNotification).toHaveBeenCalledWith("Rundflug-Leitstand", {
      body: "Bitte jetzt zum Gate kommen.",
      data: { url: "/gruppe/NPQRSTUVWXYZ2" },
      lang: "de",
    });
  });
});
