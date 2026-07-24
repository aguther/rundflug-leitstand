import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
const viteConfigSource = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const pushWorkerSource = readFileSync(new URL("../public/push-sw.js", import.meta.url), "utf8");

describe("PWA deployment updates", () => {
  it("never serves the generic application shell for API or installable-route navigations", () => {
    expect(viteConfigSource).toContain("/^\\/api(?:\\/|$)/");
    expect(viteConfigSource).toContain("/^\\/(?:ticket|gruppe)\\//");
    expect(viteConfigSource).toContain("/^\\/(?:kasse|admin|fids)(?:\\/|$)/");
    expect(viteConfigSource).toContain("/^\\/(?:flight-director|flight-line)(?:\\/|$)/");
  });

  it("uses exactly one automatic update path without a WebKit reload loop", () => {
    expect(viteConfigSource).toContain('registerType: "autoUpdate"');
    expect(mainSource).toContain("registerSW({");
    expect(mainSource).toContain("immediate: true");
    expect(mainSource).not.toContain('addEventListener("controllerchange"');
    expect(mainSource).not.toContain("window.location.reload()");
    expect(mainSource).not.toContain("registration?.update()");
    expect(mainSource).not.toContain("registration?.unregister()");
  });

  it("keeps API navigation out of the application cache without dropping web push", () => {
    expect(pushWorkerSource).not.toContain('addEventListener("fetch"');
    expect(pushWorkerSource).toContain('addEventListener("push"');
  });
});
