import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import assistSource from "../../flight-line-assist.tsx?raw";
import supervisorSource from "../../flight-line-supervisor.tsx?raw";

const stylesSource = [
  "./flight-line-v12.css",
  "../ui-finish-v12.css",
  "../operations-finish-v12.css",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");

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

  it("shows one actionable aircraft at a time on a phone", () => {
    expect(assistSource).toContain("Nächstes Flugzeug");
    expect(stylesSource).toContain(".assist-aircraft-cards article:nth-child(n + 2)");
    expect(stylesSource).toContain(".assist-more-phone");
    expect(stylesSource).toContain(".assist-command-chevron");
    expect(stylesSource).toContain("grid-template-columns: 42px minmax(0, 1fr) 18px");
  });

  it("applies the approved operations finish without leaking into unrelated views", () => {
    expect(stylesSource).toContain(".assist-shell .aircraft-pause-dialog");
    expect(stylesSource).toContain("border-radius: 24px 24px 0 0");
    expect(stylesSource).toContain(".assist-meta-item");
    expect(stylesSource).toContain(".setup-shell .setup-page");
    expect(stylesSource).not.toContain("body > button");
  });
});
