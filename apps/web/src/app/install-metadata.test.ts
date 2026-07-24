import { describe, expect, it } from "vitest";
import { installMetadataForPath, publicStatusInstallMetadata } from "./install-metadata";

describe("ansichtsspezifische Installationsmetadaten", () => {
  it.each([
    ["/kasse", "/manifests/kasse.webmanifest", "/icons/kasse-icon-180.png"],
    [
      "/flight-director",
      "/manifests/flight-director.webmanifest",
      "/icons/flight-line-icon-180.png",
    ],
    ["/flight-line", "/manifests/flight-line.webmanifest", "/icons/assist-icon-180.png"],
    ["/fids", "/manifests/fids.webmanifest", "/icons/fids-icon-180.png"],
    ["/fids/terminal", "/manifests/fids.webmanifest", "/icons/fids-icon-180.png"],
    ["/admin", "/manifests/admin.webmanifest", "/icons/admin-icon-180.png"],
  ])("ordnet %s ein eigenes Manifest und Symbol zu", (path, manifestHref, iconHref) => {
    expect(installMetadataForPath(path)).toMatchObject({
      manifestHref,
      appleTouchIconHref: iconHref,
    });
  });

  it("registriert den alten Assist-Pfad nicht mehr", () => {
    expect(installMetadataForPath("/flight-line/assist")).toBeNull();
  });

  it("bindet öffentliche Codes nur in das seitenspezifische Manifest ein", () => {
    expect(installMetadataForPath("/ticket/ABCDE2345678")).toMatchObject({
      manifestHref: "/api/public/pwa-manifest/ticket/ABCDE2345678",
      appleTouchIconHref: "/icons/ticket-icon-180.png",
    });
    expect(installMetadataForPath("/gruppe/FGHJK2345678")).toMatchObject({
      manifestHref: "/api/public/pwa-manifest/group/FGHJK2345678",
      appleTouchIconHref: "/icons/ticket-icon-180.png",
    });
  });

  it("setzt die Ticketgruppe als iOS- und Dokumenttitel", () => {
    expect(publicStatusInstallMetadata("ticket", "ABCDE2345678", "G-PAN20-0133")).toMatchObject({
      appleTitle: "G-PAN20-0133",
      documentTitle: "G-PAN20-0133 · Rundflug",
    });
  });
});
