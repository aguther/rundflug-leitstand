import { describe, expect, it } from "vitest";
import indexHtml from "../../web/index.html?raw";
import iconSource from "../../web/public/icons/app-icon.svg?raw";
import appleTouchIconUrl from "../../web/public/icons/app-icon-180.png?url";
import icon192Url from "../../web/public/icons/app-icon-192.png?url";
import icon512Url from "../../web/public/icons/app-icon-512.png?url";
import icon512MaskableUrl from "../../web/public/icons/app-icon-512-maskable.png?url";
import viteConfig from "../../web/vite.config.ts?raw";

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

  it("exposes browser and iOS metadata using the established anonymous brand mark", () => {
    expect(indexHtml).toContain('rel="apple-touch-icon"');
    expect(indexHtml).toContain('name="theme-color"');
    expect(appleTouchIconUrl).toContain("app-icon-180.png");
    expect(iconSource).toContain('aria-label="Rundflug-Leitstand"');
    expect(iconSource).toContain("#102a43");
    expect(iconSource).toContain("#2f8af5");
  });
});
