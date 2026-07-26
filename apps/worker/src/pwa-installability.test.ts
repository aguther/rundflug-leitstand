// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import wranglerConfig from "../../../wrangler.jsonc?raw";
import indexHtml from "../../web/index.html?raw";
import adminManifest from "../../web/public/manifests/admin.webmanifest?raw";
import fidsManifest from "../../web/public/manifests/fids.webmanifest?raw";
import flightDirectorManifest from "../../web/public/manifests/flight-director.webmanifest?raw";
import flightLineManifest from "../../web/public/manifests/flight-line.webmanifest?raw";
import kasseManifest from "../../web/public/manifests/kasse.webmanifest?raw";
import viteConfig from "../../web/vite.config.ts?raw";
import worker from "./index.ts?raw";

const iconProfiles = [
  "brand",
  "kasse",
  "flight-director",
  "flight-line",
  "fids",
  "admin",
  "ticket",
] as const;

const staticManifests = [
  [kasseManifest, "/kasse", "kasse"],
  [flightDirectorManifest, "/flight-director", "flight-director"],
  [flightLineManifest, "/flight-line", "flight-line"],
  [fidsManifest, "/fids", "fids"],
  [adminManifest, "/admin", "admin"],
] as const;

function iconAssetUrl(profile: (typeof iconProfiles)[number], filename: string): URL {
  return new URL(`../../web/public/icons/pwa/${profile}/${filename}`, import.meta.url);
}

function pngDimensions(url: URL): { width: number; height: number } {
  const bytes = readFileSync(url);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe("T-010 PWA installability and icon family", () => {
  it("ships the branded root manifest with regular and maskable icon sizes", () => {
    expect(viteConfig).toContain('display: "standalone"');
    expect(viteConfig).toContain("/icons/pwa/brand/icon-192.png");
    expect(viteConfig).toContain("/icons/pwa/brand/icon-512.png");
    expect(viteConfig).toContain("/icons/pwa/brand/maskable-192.png");
    expect(viteConfig).toContain("/icons/pwa/brand/maskable-512.png");
    expect(viteConfig).toContain('purpose: "maskable"');
    expect(viteConfig).toContain('navigateFallback: "/index.html"');
  });

  it("exposes the new brand favicon and iOS icon in the generic document", () => {
    expect(indexHtml).toContain(
      'rel="icon" href="/icons/pwa/brand/favicon.svg" type="image/svg+xml"',
    );
    expect(indexHtml).toContain(
      'rel="apple-touch-icon" href="/icons/pwa/brand/apple-touch-icon-180.png"',
    );
    expect(indexHtml).toContain('name="theme-color"');
  });

  it.each(iconProfiles)("ships a complete and visually synchronized %s asset set", (profile) => {
    expect(
      readdirSync(new URL(`../../web/public/icons/pwa/${profile}/`, import.meta.url)).sort(),
    ).toEqual([
      "apple-touch-icon-180.png",
      "favicon.svg",
      "icon-192.png",
      "icon-512.png",
      "maskable-192.png",
      "maskable-512.png",
    ]);

    const favicon = readFileSync(iconAssetUrl(profile, "favicon.svg"), "utf8");
    expect(favicon).toContain("#FFB020");
    expect(favicon).toContain("#0D1B26");
    expect(favicon).toContain("#E6EDF3");
    expect(favicon).toContain("prefers-color-scheme: dark");

    expect(pngDimensions(iconAssetUrl(profile, "apple-touch-icon-180.png"))).toEqual({
      width: 180,
      height: 180,
    });
    expect(pngDimensions(iconAssetUrl(profile, "icon-192.png"))).toEqual({
      width: 192,
      height: 192,
    });
    expect(pngDimensions(iconAssetUrl(profile, "icon-512.png"))).toEqual({
      width: 512,
      height: 512,
    });
    expect(pngDimensions(iconAssetUrl(profile, "maskable-192.png"))).toEqual({
      width: 192,
      height: 192,
    });
    expect(pngDimensions(iconAssetUrl(profile, "maskable-512.png"))).toEqual({
      width: 512,
      height: 512,
    });
  });

  it.each(staticManifests)(
    "liefert für %s einen stabilen Startpfad und vier eindeutige Icons",
    (raw, path, profile) => {
      const manifest = JSON.parse(raw) as {
        id: string;
        start_url: string;
        display: string;
        icons: Array<{ src: string; sizes: string; purpose: string }>;
      };
      expect(manifest.id).toBe(path);
      expect(manifest.start_url).toBe(path);
      expect(manifest.display).toBe("standalone");
      expect(manifest.icons).toEqual([
        {
          src: `/icons/pwa/${profile}/icon-192.png`,
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `/icons/pwa/${profile}/icon-512.png`,
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `/icons/pwa/${profile}/maskable-192.png`,
          sizes: "192x192",
          type: "image/png",
          purpose: "maskable",
        },
        {
          src: `/icons/pwa/${profile}/maskable-512.png`,
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ]);
    },
  );

  it("schreibt Manifest, Favicon und iOS-Metadaten für alle Hauptansichten in den ersten HTML-Stream", () => {
    for (const path of [
      '"/kasse"',
      '"/flight-director"',
      '"/flight-line"',
      '"/fids"',
      '"/admin"',
    ]) {
      expect(worker).toContain(path);
    }
    for (const profile of ["kasse", "flight-director", "flight-line", "fids", "admin"]) {
      expect(worker).toContain(`faviconHref: "/icons/pwa/${profile}/favicon.svg"`);
      expect(worker).toContain(
        `appleTouchIconHref: "/icons/pwa/${profile}/apple-touch-icon-180.png"`,
      );
    }
    expect(worker).toMatch(
      /<link rel="icon" href="\$\{escapeHtmlAttribute\(profile\.faviconHref\)\}"/,
    );
    expect(worker).toContain(`.on('link[rel="icon"]'`);
    for (const path of ["/kasse", "/flight-director", "/flight-line", "/fids/*", "/admin"]) {
      expect(wranglerConfig).toContain(path);
    }
    expect(worker).not.toContain('"/flight-line/assist"');
    expect(wranglerConfig).not.toContain('"/flight-line/*"');
    expect(worker).toContain("INTERNAL_APP_INSTALL_PROFILES");
    expect(worker).toContain("installableAppShellResponse");
  });

  it("uses the ticket family for public ticket and group installations", () => {
    expect(worker).toContain("/icons/pwa/ticket/favicon.svg");
    expect(worker).toContain("/icons/pwa/ticket/apple-touch-icon-180.png");
    expect(worker).toContain("/icons/pwa/ticket/icon-192.png");
    expect(worker).toContain("/icons/pwa/ticket/icon-512.png");
    expect(worker).toContain("/icons/pwa/ticket/maskable-192.png");
    expect(worker).toContain("/icons/pwa/ticket/maskable-512.png");
  });

  it("umgeht für installierbare Routen den generischen Workbox-Navigationsfallback", () => {
    expect(viteConfig).toContain("/^\\/(?:ticket|gruppe)\\//");
    expect(viteConfig).toContain("/^\\/(?:kasse|admin|fids)(?:\\/|$)/");
    expect(viteConfig).toContain("/^\\/(?:flight-director|flight-line)(?:\\/|$)/");
  });
});
