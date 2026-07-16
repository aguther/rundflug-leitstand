import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
const viteConfigSource = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const pushWorkerSource = readFileSync(new URL("../public/push-sw.js", import.meta.url), "utf8");

describe("PWA deployment updates", () => {
  it("never serves the application shell for API navigations", () => {
    expect(viteConfigSource).toContain("navigateFallbackDenylist: [/^\\/api(?:\\/|$)/]");
  });

  it("reloads an open client once when a new service worker takes control", () => {
    expect(mainSource).toContain('addEventListener("controllerchange"');
    expect(mainSource).toContain("reloadingForServiceWorkerUpdate = true");
    expect(mainSource).toContain("window.location.reload()");
  });

  it("always sends API requests directly to the network without dropping web push", () => {
    expect(apiSource).toMatch(/getOperationBoard[\s\S]*cache: "no-store"/);
    expect(pushWorkerSource).not.toContain('addEventListener("fetch"');
    expect(pushWorkerSource).toContain('addEventListener("push"');
  });
});
