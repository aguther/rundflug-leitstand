import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import assistSource from "../../flight-line-assist.tsx?raw";
import supervisorSource from "../../flight-line-supervisor.tsx?raw";

const stylesSource = readFileSync(new URL("./flight-line-v12.css", import.meta.url), "utf8");

describe("V1.2 Flight Line surfaces", () => {
  it("keeps Supervisor and Assist as explicit independent workspaces", () => {
    expect(supervisorSource).toContain('href="/flight-line/assist"');
    expect(assistSource).toContain('href="/flight-line"');
    expect(assistSource).toContain('session.account.role !== "FLIGHT_LINE"');
  });

  it("uses the common brand and exposes theme switching in both headers", () => {
    expect(supervisorSource).toContain("<BrandMark />");
    expect(assistSource).toContain("<BrandMark />");
    expect(supervisorSource).toContain("<ThemeToggle />");
    expect(assistSource).toContain("<ThemeToggle />");
  });

  it("keeps the complete Supervisor workflow on iPad without the desktop rails", () => {
    expect(stylesSource).toContain("@media (max-width: 1180px)");
    expect(stylesSource).toContain(".flight-line-console-main");
    expect(stylesSource).toContain(".console-aircraft-list");
  });

  it("uses semantic light and dark surfaces and touch-sized Assist actions", () => {
    expect(stylesSource).toContain("--assist-panel: var(--ui-surface)");
    expect(stylesSource).toContain("--console-bg: var(--ui-bg)");
    expect(stylesSource).toContain("min-height: 34px");
  });
});
