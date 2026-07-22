import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import assistSource from "../../flight-line-assist.tsx?raw";
import sharedSource from "../../flight-line-shared.tsx?raw";
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

  it("implements the V1.7.0 compact aircraft table with centered dialogs", () => {
    expect(supervisorSource).toContain("flight-director-aircraft-row");
    expect(supervisorSource).toContain("ModalDialog");
    expect(sharedSource).toContain("Buchungsgruppen zuweisen");
    expect(sharedSource).toContain("Gruppen bleiben vollständig zusammen");
    expect(supervisorSource).not.toContain("expanded");
    expect(viewSource).not.toContain('className="pilot-assignment"');
    expect(supervisorSource).not.toContain("sidebarNavItems");
    expect(stylesSource).toContain(".flight-director-aircraft-head");
    expect(stylesSource).toContain(".flight-director-assignment-dialog");
  });

  it("uses shared controls for operational actions and fields", () => {
    expect(supervisorSource).toContain("Button,");
    expect(supervisorSource).toContain("IconButton,");
    expect(supervisorSource).toContain("SelectField,");
    expect(supervisorSource).toContain("ModalDialog,");
    expect(supervisorSource).not.toContain("StatusPill,");
    expect(supervisorSource).not.toContain("Tabs,");
    expect(supervisorSource).toContain("PilotAssignmentDialogs");
    expect(assistSource).toContain("PilotAssignmentDialogs");
    expect(sharedSource).toContain("CompactCurrentRotation");
    expect(sharedSource).toContain("CompactHistory");
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

  it("implements exclusive aircraft selection and work modes on every viewport", () => {
    expect(assistSource).toContain("if (!activeAircraft)");
    expect(assistSource).toContain("is-selection-mode");
    expect(assistSource).toContain("is-work-mode");
    expect(assistSource).toContain("assist-v15-active-column");
    expect(assistSource).toContain("availableAircraft.slice(0, visibleAircraftCount)");
    expect(assistSource).not.toContain("assist-v15-workspace");
    expect(assistSource).not.toContain('className="assist-v15-groups"');
    expect(assistSource).toContain("BookingGroupAssignmentDialog");
    expect(stylesSource).toContain("@media (max-width: 760px)");
    expect(stylesSource).toContain(".flight-assist-v15 .assist-v15-aircraft-list");
    expect(stylesSource).toContain(".assist-v15-group-popover");
  });

  it("keeps iPad viewports inside the shell with one scrollable aircraft table", () => {
    expect(stylesSource).toContain(".flight-director-aircraft-table");
    expect(stylesSource).toContain(".ds-panel.flight-director-aircraft");
    expect(stylesSource).toContain("-webkit-overflow-scrolling: touch");
    expect(stylesSource).toContain("touch-action: pan-x pan-y");
    expect(stylesSource).toMatch(
      /@media \(max-width: 1250px\)[\s\S]*\.flight-line-shell[\s\S]*overflow: hidden/,
    );
    expect(stylesSource).toContain("@media (max-height: 820px) and (min-width: 801px)");
    expect(stylesSource).toContain("overscroll-behavior: contain");
    expect(stylesSource).not.toContain(".flight-director-aircraft-row > span {");
  });

  it("applies the approved operations finish without leaking into unrelated views", () => {
    expect(stylesSource).toContain(".assist-shell .aircraft-pause-dialog");
    expect(stylesSource).toContain("border-radius: 24px 24px 0 0");
    expect(stylesSource).toContain(".assist-meta-item");
    expect(stylesSource).toContain(".setup-shell .setup-page");
    expect(stylesSource).not.toContain("body > button");
  });
});
