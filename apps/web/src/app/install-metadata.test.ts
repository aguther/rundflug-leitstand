// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  applyInitialInstallMetadata,
  applyInstallMetadata,
  installMetadataForPath,
  publicStatusInstallMetadata,
} from "./install-metadata";

describe("ansichtsspezifische Installationsmetadaten", () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.title = "";
    window.history.replaceState({}, "", "/");
  });

  it.each([
    [
      "/kasse",
      "/manifests/kasse.webmanifest",
      "/icons/pwa/kasse/favicon.svg",
      "/icons/pwa/kasse/apple-touch-icon-180.png",
    ],
    [
      "/flight-director",
      "/manifests/flight-director.webmanifest",
      "/icons/pwa/flight-director/favicon.svg",
      "/icons/pwa/flight-director/apple-touch-icon-180.png",
    ],
    [
      "/flight-line",
      "/manifests/flight-line.webmanifest",
      "/icons/pwa/flight-line/favicon.svg",
      "/icons/pwa/flight-line/apple-touch-icon-180.png",
    ],
    [
      "/fids",
      "/manifests/fids.webmanifest",
      "/icons/pwa/fids/favicon.svg",
      "/icons/pwa/fids/apple-touch-icon-180.png",
    ],
    [
      "/fids/terminal",
      "/manifests/fids.webmanifest",
      "/icons/pwa/fids/favicon.svg",
      "/icons/pwa/fids/apple-touch-icon-180.png",
    ],
    [
      "/admin",
      "/manifests/admin.webmanifest",
      "/icons/pwa/admin/favicon.svg",
      "/icons/pwa/admin/apple-touch-icon-180.png",
    ],
  ])(
    "ordnet %s ein eigenes Manifest, Favicon und App-Symbol zu",
    (path, manifestHref, faviconHref, appleTouchIconHref) => {
      expect(installMetadataForPath(path)).toMatchObject({
        manifestHref,
        faviconHref,
        appleTouchIconHref,
      });
    },
  );

  it("registriert den alten Assist-Pfad nicht mehr", () => {
    expect(installMetadataForPath("/flight-line/assist")).toBeNull();
  });

  it("bindet öffentliche Codes nur in das seitenspezifische Manifest ein", () => {
    expect(installMetadataForPath("/ticket/ABCDE2345678")).toMatchObject({
      manifestHref: "/api/public/pwa-manifest/ticket/ABCDE2345678",
      faviconHref: "/icons/pwa/ticket/favicon.svg",
      appleTouchIconHref: "/icons/pwa/ticket/apple-touch-icon-180.png",
    });
    expect(installMetadataForPath("/gruppe/FGHJK2345678")).toMatchObject({
      manifestHref: "/api/public/pwa-manifest/group/FGHJK2345678",
      faviconHref: "/icons/pwa/ticket/favicon.svg",
      appleTouchIconHref: "/icons/pwa/ticket/apple-touch-icon-180.png",
    });
  });

  it("setzt die Ticketgruppe als iOS- und Dokumenttitel", () => {
    expect(publicStatusInstallMetadata("ticket", "ABCDE2345678", "G-PAN20-0133")).toMatchObject({
      appleTitle: "G-PAN20-0133",
      documentTitle: "G-PAN20-0133 · Rundflug",
    });
  });

  it("erzeugt fehlende Dokumentmetadaten und aktualisiert vorhandene Knoten", () => {
    const existingManifest = document.createElement("link");
    existingManifest.rel = "manifest";
    document.head.append(existingManifest);
    const existingAppleTitle = document.createElement("meta");
    existingAppleTitle.name = "apple-mobile-web-app-title";
    document.head.append(existingAppleTitle);

    applyInstallMetadata(publicStatusInstallMetadata("group", "ABCDE2345678"));

    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);
    expect(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href).toContain(
      "/api/public/pwa-manifest/group/ABCDE2345678",
    );
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.type).toBe("image/svg+xml");
    expect(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href).toContain(
      "/icons/pwa/ticket/apple-touch-icon-180.png",
    );
    expect(existingAppleTitle.content).toBe("Gruppenstatus");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-capable"]')?.content,
    ).toBe("yes");
    expect(document.title).toBe("Gruppenstatus · Rundflug");
  });

  it("wendet initiale Metadaten nur für installierbare Pfade an", () => {
    window.history.replaceState({}, "", "/admin");
    applyInitialInstallMetadata();
    expect(document.title).toBe("Admin · Rundflug-Leitstand");

    document.head.replaceChildren();
    document.title = "Unverändert";
    window.history.replaceState({}, "", "/unbekannt");
    applyInitialInstallMetadata();
    expect(document.title).toBe("Unverändert");
    expect(document.head.querySelectorAll("link, meta")).toHaveLength(0);
  });

  it("weist öffentliche Standardtitel und ungültige Codes eindeutig zu", () => {
    expect(publicStatusInstallMetadata("ticket", "abc/def")).toMatchObject({
      appleTitle: "Ticketstatus",
      documentTitle: "Ticketstatus · Rundflug",
      manifestHref: "/api/public/pwa-manifest/ticket/abc%2Fdef",
    });
    expect(installMetadataForPath("/ticket/INVALID-0000")).toBeNull();
    expect(installMetadataForPath("/gruppe/short")).toBeNull();
  });
});
