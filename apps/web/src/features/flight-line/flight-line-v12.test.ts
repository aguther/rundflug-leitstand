import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import assistSource from "../../flight-line-assist.tsx?raw";
import supervisorSource from "../../flight-line-supervisor.tsx?raw";
import viewSource from "../../flight-line-view.tsx?raw";

const stylesSource = [
  "./flight-line-v12.css",
  "./flight-line-assist-v15.css",
  "../ui-finish-v12.css",
  "../operations-finish-v12.css",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");

describe("V1.2 Flight Line surfaces", () => {
  it("keeps Supervisor and Assist as explicit independent workspaces behind the shared shell", () => {
    expect(viewSource).toContain("<FlightLineSupervisorConsole");
    expect(viewSource).toContain("<FlightLineAssist");
    expect(viewSource).toContain(
      'title={FLIGHT_LINE_ASSIST_MODE ? "Flight Line Assist" : "Flight Line"}',
    );
  });

  it("does not duplicate the shared application header inside the Supervisor", () => {
    expect(viewSource).toContain("<Shell");
    expect(supervisorSource).not.toContain("<BrandMark");
    expect(supervisorSource).not.toContain("<ThemeToggle");
    expect(supervisorSource).not.toContain("flight-line-console-header");
    expect(assistSource).not.toContain("<BrandMark");
    expect(assistSource).not.toContain("<ThemeToggle");
    expect(assistSource).not.toContain("assist-header");
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

  it("uses semantic light and dark surfaces and central Assist actions", () => {
    expect(stylesSource).toContain("--assist-panel: var(--ui-surface)");
    expect(stylesSource).toContain("--console-bg: var(--ui-bg)");
    expect(assistSource).toContain("<Button");
    expect(assistSource).toContain("<IconButton");
    expect(assistSource).toContain("<PageHeader");
    expect(assistSource).toContain("<Panel");
    expect(assistSource).toContain("<StatusPill");
  });

  it("implements the approved tablet workspace and keeps the aircraft list on phones", () => {
    expect(assistSource).toContain("assist-v15-workspace");
    expect(assistSource).toContain("assist-v15-active-column");
    expect(assistSource).toContain("listedAircraft.slice(0, visibleAircraftCount)");
    expect(assistSource).toContain("Von dir übernommen");
    expect(assistSource).not.toContain("assist-v15-phone-back");
    expect(assistSource).toContain("assist-v15-group-menu");
    expect(stylesSource).toContain("@media (max-width: 760px)");
    expect(stylesSource).toContain(".flight-assist-v15 .assist-v15-aircraft-list");
    expect(stylesSource).toContain(".assist-v15-group-popover");
  });

  it("applies the approved operations finish without leaking into unrelated views", () => {
    expect(stylesSource).toContain(".assist-shell .aircraft-pause-dialog");
    expect(stylesSource).toContain("border-radius: 24px 24px 0 0");
    expect(stylesSource).toContain(".assist-meta-item");
    expect(stylesSource).toContain(".setup-shell .setup-page");
    expect(stylesSource).not.toContain("body > button");
  });
});
