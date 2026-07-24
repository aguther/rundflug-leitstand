import { describe, expect, it } from "vitest";
import wranglerConfig from "../../../wrangler.jsonc?raw";
import indexHtml from "../../web/index.html?raw";
import iconSource from "../../web/public/icons/app-icon.svg?raw";
import appleTouchIconUrl from "../../web/public/icons/app-icon-180.png?url";
import icon192Url from "../../web/public/icons/app-icon-192.png?url";
import icon512Url from "../../web/public/icons/app-icon-512.png?url";
import icon512MaskableUrl from "../../web/public/icons/app-icon-512-maskable.png?url";
import adminManifest from "../../web/public/manifests/admin.webmanifest?raw";
import fidsManifest from "../../web/public/manifests/fids.webmanifest?raw";
import flightDirectorManifest from "../../web/public/manifests/flight-director.webmanifest?raw";
import flightLineManifest from "../../web/public/manifests/flight-line.webmanifest?raw";
import kasseManifest from "../../web/public/manifests/kasse.webmanifest?raw";
import viteConfig from "../../web/vite.config.ts?raw";
import worker from "./index.ts?raw";

describe("V1 PWA installability", () => {
  it("ships standalone manifest metadata and complete install icons", () => {
    expect(viteConfig).toContain('display: "standalone"');
    expect(viteConfig).toContain('sizes: "192x192"');
    expect(viteConfig).toContain('sizes: "512x512"');
    expect(viteConfig).toContain('purpose: "maskable"');
    expect(viteConfig).toContain('navigateFallback: "/index.html"');
    expect(icon192Url).toContain("app-icon-192.png");
    expect(icon512Url).toContain("app-icon-512.png");
    expect(icon512MaskableUrl).toContain("app-icon-512-maskable.png");
  });

  it("exposes browser and iOS metadata using the simplified plane brand mark", () => {
    expect(indexHtml).toContain('rel="apple-touch-icon"');
    expect(indexHtml).toContain('name="theme-color"');
    expect(appleTouchIconUrl).toContain("app-icon-180.png");
    expect(iconSource).toContain('aria-label="Rundflug-Leitstand"');
    expect(iconSource).toContain("#151618");
    expect(iconSource).toContain("#2f8af5");
    expect(iconSource).not.toContain("<circle");
  });

  it.each([
    [kasseManifest, "/kasse", "kasse"],
    [flightDirectorManifest, "/flight-director", "flight-line"],
    [flightLineManifest, "/flight-line", "assist"],
    [fidsManifest, "/fids", "fids"],
    [adminManifest, "/admin", "admin"],
  ])("liefert für %s einen eigenen Startpfad und ein eindeutiges Icon", (raw, path, iconName) => {
    const manifest = JSON.parse(raw) as {
      id: string;
      start_url: string;
      display: string;
      icons: Array<{ src: string }>;
    };
    expect(manifest.id).toBe(path);
    expect(manifest.start_url).toBe(path);
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.every((icon) => icon.src.includes(`/${iconName}-icon-`))).toBe(true);
  });

  it("schreibt die Installationsmetadaten für alle Hauptansichten in den ersten HTML-Stream", () => {
    for (const path of [
      '"/kasse"',
      '"/flight-director"',
      '"/flight-line"',
      '"/fids"',
      '"/admin"',
    ]) {
      expect(worker).toContain(path);
    }
    for (const path of ["/kasse", "/flight-director", "/flight-line", "/fids/*", "/admin"]) {
      expect(wranglerConfig).toContain(path);
    }
    expect(worker).not.toContain('"/flight-line/assist"');
    expect(wranglerConfig).not.toContain('"/flight-line/*"');
    expect(worker).toContain("INTERNAL_APP_INSTALL_PROFILES");
    expect(worker).toContain("installableAppShellResponse");
  });

  it("umgeht für installierbare Routen den generischen Workbox-Navigationsfallback", () => {
    expect(viteConfig).toContain("/^\\/(?:ticket|gruppe)\\//");
    expect(viteConfig).toContain("/^\\/(?:kasse|admin|fids)(?:\\/|$)/");
    expect(viteConfig).toContain("/^\\/(?:flight-director|flight-line)(?:\\/|$)/");
  });
});
