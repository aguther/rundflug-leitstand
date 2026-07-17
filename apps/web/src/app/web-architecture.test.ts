import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "../App.tsx?raw";

describe("V1.2 web architecture", () => {
  it("keeps App.tsx as composition glue", () => {
    const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(source.length).toBeLessThan(2_000);
    expect(source).not.toContain("sendCommand(");
    expect(source).not.toContain("useState(");
    expect(source).toContain('import("./LegacyApp")');
    expect(source).not.toContain('from "./LegacyApp"');
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

  it("keeps anonymous FIDS and ticket views public while protecting internal workspaces", () => {
    expect(appSource).toContain('pathname === "/fids"');
    expect(appSource).toContain('pathname.startsWith("/fids/")');
    expect(appSource).toContain("if (!session) return <LoginPage />");
  });
});
