import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
const viteConfigSource = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

describe("PWA deployment updates", () => {
  it("never serves the application shell for API navigations", () => {
    expect(viteConfigSource).toContain("navigateFallbackDenylist: [/^\\/api(?:\\/|$)/]");
  });

  it("reloads an open client once when a new service worker takes control", () => {
    expect(mainSource).toContain('addEventListener("controllerchange"');
    expect(mainSource).toContain("reloadingForServiceWorkerUpdate = true");
    expect(mainSource).toContain("window.location.reload()");
  });
});
