import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import assistSource from "../../flight-line-assist.tsx?raw";
import supervisorSource from "../../flight-line-supervisor.tsx?raw";
import viewSource from "../../flight-line-view.tsx?raw";

const stylesSource = [
  "./flight-line-v12.css",
  "../ui-finish-v12.css",
  "../operations-finish-v12.css",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");

describe("V1.2 Flight Line surfaces", () => {
  it("keeps Supervisor and Assist as explicit independent workspaces behind the shared shell", () => {
    expect(viewSource).toContain("<FlightLineSupervisorConsole");
    expect(viewSource).toContain("<FlightLineAssist");
    expect(assistSource).toContain('href="/flight-line"');
    expect(assistSource).toContain('session.account.role !== "FLIGHT_LINE"');
  });

  it("does not duplicate the shared application header inside the Supervisor", () => {
    expect(viewSource).toContain("<Shell");
    expect(supervisorSource).not.toContain("<BrandMark");
    expect(supervisorSource).not.toContain("<ThemeToggle");
    expect(supervisorSource).not.toContain("flight-line-console-header");
    expect(assistSource).toContain("<BrandMark />");
    expect(assistSource).toContain("<ThemeToggle />");
  });

  it("implements the V1.5 aircraft table with one expandable assignment workspace", () => {
    expect(supervisorSource).toContain("flight-director-aircraft-row");
    expect(supervisorSource).toContain("flight-director-assignment");
    expect(supervisorSource).toContain("Buchungsgruppen zuweisen");
    expect(supervisorSource).toContain("Gruppen bleiben vollständig zusammen");
    expect(supervisorSource).not.toContain("sidebarNavItems");
    expect(stylesSource).toContain(".flight-director-aircraft-head");
    expect(stylesSource).toContain(".flight-director-assignment-body");
  });

  it("uses shared controls for operational actions and fields", () => {
    expect(supervisorSource).toContain("Button,");
    expect(supervisorSource).toContain("IconButton,");
    expect(supervisorSource).toContain("SelectField,");
    expect(supervisorSource).toContain("StatusPill,");
    expect(supervisorSource).toContain("Tabs,");
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
