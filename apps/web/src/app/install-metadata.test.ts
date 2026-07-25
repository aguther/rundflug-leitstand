import { describe, expect, it } from "vitest";
import { installMetadataForPath, publicStatusInstallMetadata } from "./install-metadata";

describe("ansichtsspezifische Installationsmetadaten", () => {
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
  ])("ordnet %s ein eigenes Manifest, Favicon und App-Symbol zu", (path, manifestHref, faviconHref, appleTouchIconHref) => {
    expect(installMetadataForPath(path)).toMatchObject({
      manifestHref,
      faviconHref,
      appleTouchIconHref,
    });
  });

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
});
