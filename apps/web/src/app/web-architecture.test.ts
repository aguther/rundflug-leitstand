import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "../App.tsx?raw";
import featureRouterSource from "../FeatureRouter.tsx?raw";

describe("V1.2 web architecture", () => {
  it("keeps App.tsx as composition glue", () => {
    const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(source.length).toBeLessThan(2_000);
    expect(source).not.toContain("sendCommand(");
    expect(source).not.toContain("useState(");
    expect(source).toContain('import("./FeatureRouter")');
    expect(source).not.toContain('from "./FeatureRouter"');
  });

  it("has explicit app-shell, theme and token modules", () => {
    for (const relative of [
      "./AppShell.tsx",
      "../design-system/theme.tsx",
      "../design-system/tokens.css",
      "../design-system/base.css",
    ]) {
      expect(() => readFileSync(new URL(relative, import.meta.url), "utf8")).not.toThrow();
    }
  });

  it("keeps route features in independent dynamically loaded modules", () => {
    expect(featureRouterSource.length).toBeLessThan(4_000);
    for (const moduleName of [
      "admin-view",
      "cashier-view",
      "fids-view",
      "flight-line-view",
      "privacy-view",
      "setup-view",
      "ticket-status-view",
    ]) {
      expect(featureRouterSource).toContain(`import("./${moduleName}")`);
      expect(featureRouterSource).not.toContain(`from "./${moduleName}"`);
    }
  });

  it("keeps only ticket views public while protecting FIDS and internal workspaces", () => {
    expect(appSource).not.toContain('pathname === "/fids"');
    expect(appSource).not.toContain('pathname === "/pair"');
    expect(appSource).not.toContain('pathname.startsWith("/fids/")');
    expect(appSource).toContain("if (!session) return <LoginPage />");
  });
});
