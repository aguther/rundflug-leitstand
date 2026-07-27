import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminUxSource from "./admin-ux.tsx?raw";
import adminViewSource from "./admin-view.tsx?raw";
import apiSource from "./api.ts?raw";
import chartSource from "./features/admin/AdminEventFlowChart.tsx?raw";
import eventLogoEditorSource from "./features/admin/EventLogoEditor.tsx?raw";

const adminStyles = readFileSync(
  new URL("./features/admin/admin-v15.css", import.meta.url),
  "utf8",
);
const adminEventStyles = readFileSync(
  new URL("./features/admin/admin-event-workspace.css", import.meta.url),
  "utf8",
);

describe("V1.5 administration UI", () => {
  it("uses one compact setup flow and the shared design-system primitives", () => {
    expect(adminViewSource.match(/<SetupProgress/g)).toHaveLength(1);
    expect(adminViewSource).toContain('className="event-setup-v15 single-panel"');
    expect(adminViewSource).toContain('className="event-release-v15"');
    expect(adminViewSource).toContain('className="event-catalog-v15"');
    expect(adminViewSource).toContain("<PageHeader");
    expect(adminViewSource).toContain("<Panel");
    expect(adminViewSource).toContain("<TextField");
    expect(adminViewSource).toContain("<Button");
  });

  it("keeps reset actions out of the event setup workspace", () => {
    const setupWorkspace = adminViewSource.slice(
      adminViewSource.indexOf('<div className="event-setup-v15"'),
      adminViewSource.indexOf('<Panel className="event-catalog-v15"'),
    );
    expect(setupWorkspace).not.toContain("Betriebsdaten zurücksetzen");
    expect(setupWorkspace).not.toContain("Werkszustand");
  });

  it("supports SVG branding and consistent Pilotencode terminology", () => {
    expect(eventLogoEditorSource).toContain("image/svg+xml");
    expect(eventLogoEditorSource).toContain("PNG, JPEG, WebP oder sicheres SVG bis 1 MiB.");
    expect(eventLogoEditorSource).toContain("Logo für {themeLabel}");
    expect(apiSource).toMatch(/logo\?theme=\$\{theme\}/);
    expect(adminUxSource).toContain('{ id: "pilots", label: "Pilotencodes" }');
  });

  it("defines stable compact and phone layouts without page-level horizontal overflow", () => {
    expect(adminStyles).toContain("grid-template-columns: repeat(6, minmax(110px, 1fr))");
    expect(adminStyles).toContain("grid-template-columns: minmax(150px, 1fr) auto 112px");
    expect(adminStyles).toContain("overflow-x: auto");
    expect(adminStyles).toContain("scrollbar-width: none");
    expect(adminStyles).toContain("flex-direction: column");
  });

  it("keeps the event workspace dense and gives setup focus a stable footprint", () => {
    expect(adminEventStyles).toContain(".setup-progress li::before");
    expect(adminEventStyles).toContain("display: none");
    expect(adminEventStyles).toContain(".setup-progress button:focus-visible");
    expect(adminEventStyles).toContain("min-height: 46px");
    expect(adminEventStyles).toContain("height: auto");
    expect(adminEventStyles).toContain("width: min(880px, 100%)");
    expect(adminEventStyles).toContain("width: min(1040px, calc(100vw - 32px))");
    expect(adminEventStyles).toContain("width: min(680px, calc(100vw - 32px))");
    expect(adminEventStyles).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
    expect(adminEventStyles).toContain(".admin-shell .history-table-wrap");
    expect(adminEventStyles).toContain("min-height: 220px");
    expect(adminEventStyles).toContain(
      ".admin-shell .manifest-correction-grid > .manifest-reason-field",
    );
    expect(chartSource).toContain("const HEIGHT = 210");
  });

  it("keeps the area header mounted with the same geometry on master-data steps", () => {
    const workspaceHeader = adminViewSource.slice(
      adminViewSource.indexOf("<div className={`admin-workspace "),
      adminViewSource.indexOf('{adminArea === "events" ? ('),
    );

    expect(workspaceHeader).toContain("<PageHeader");
    expect(workspaceHeader).not.toContain("{!masterDataStepActive ? (");
    expect(adminStyles).toContain(".admin-shell .admin-workspace > .ds-page-header");
    expect(adminEventStyles).toContain(".admin-shell .admin-workspace > .ds-page-header");
    expect(adminStyles).not.toContain(
      ".admin-workspace:not(.master-data-active) > .ds-page-header",
    );
    expect(adminEventStyles).not.toContain(
      ".admin-workspace:not(.master-data-active) > .ds-page-header",
    );
    expect(adminEventStyles).toContain(
      ".admin-shell .admin-workspace,\n.admin-shell .admin-workspace.master-data-active",
    );
    expect(adminViewSource).not.toContain('className="master-data-heading"');
    expect(adminViewSource).not.toContain("Stammdaten <span");
    expect(adminUxSource).toContain('aria-current={current ? "step" : undefined}');
    expect(adminUxSource).toContain('step.complete ? "complete" : "pending"');
  });

  it("implements the event-scoped information architecture and legacy URL redirects", () => {
    for (const navigationItem of [
      '{ id: "overview", label: "Übersicht"',
      '{ id: "events", label: "Veranstaltungen"',
      '{ id: "users", label: "Konten"',
      '{ id: "evaluation", label: "Auswertung"',
      '{ id: "backup", label: "Sicherung & Reset"',
    ]) {
      expect(adminUxSource).toContain(navigationItem);
    }
    for (const step of [
      'id: "event"',
      'id: "gates"',
      'id: "resource-groups"',
      'id: "aircraft"',
      'id: "pilots"',
      'id: "products"',
      'id: "operations"',
      'id: "completion"',
    ]) {
      expect(adminViewSource).toContain(step);
    }
    expect(adminViewSource).toContain(
      'if (["setup", "master-data", "audit"].includes(requestedArea ?? "")) return "events";',
    );
    expect(adminViewSource).toContain('if (requestedArea === "audit") return "completion";');
  });

  it("uses event-only flow data and a strict preview-before-import workflow", () => {
    expect(adminViewSource).toContain("<AdminEventFlowChart");
    expect(chartSource).toContain("<svg");
    expect(chartSource).toContain("soldTickets");
    expect(chartSource).toContain("completedTickets");
    expect(chartSource).toContain("openTickets");
    expect(apiSource).toContain("/flow");
    expect(apiSource).toContain("/master-data-template/validate");
    expect(apiSource).toContain("/master-data-template/import");
    expect(apiSource).toContain("/exports/simulation-plan.json");
    expect(adminViewSource).toContain("Simulationsgrundlage exportieren");
    expect(adminViewSource).toContain(
      "Tickets, Ist-Verläufe und operative Zustände werden nicht exportiert.",
    );
    expect(adminViewSource).toMatch(/>\s*Importieren\s*<\/Button>/);
    expect(adminViewSource).toContain("templateValidation.counts");
    expect(adminViewSource).toContain('size="wide"');
  });

  it("uses explicit touch actions instead of clickable master-data rows", () => {
    const masterDataTables = adminViewSource.slice(
      adminViewSource.indexOf('<section className="master-data-workspace"'),
      adminViewSource.indexOf('hidden={eventStep !== "completion"}'),
    );

    expect(masterDataTables).toContain('className="master-actions-heading">Aktionen</th>');
    expect(masterDataTables).not.toContain("table-overflow-action");
    expect(masterDataTables).toContain("onEdit={() => selectGateForEditing(gate.id)}");
    expect(masterDataTables).toContain("onEdit={() => selectResourceForEditing(group.id)}");
    expect(masterDataTables).toContain("onEdit={() => selectAircraftForEditing(aircraft.id)}");
    expect(masterDataTables).toContain("onEdit={() => selectPilotForEditing(pilot.id)}");
    expect(masterDataTables).toContain("onEdit={() => selectProductForEditing(product.id)}");
    expect(masterDataTables).toContain('requestMasterDelete("GATE"');
    expect(masterDataTables).toContain('requestMasterDelete("RESOURCE_GROUP"');
    expect(masterDataTables).toMatch(/requestMasterDelete\(\s*"AIRCRAFT"/);
    expect(masterDataTables).toContain('requestMasterDelete("PILOT"');
    expect(masterDataTables).toContain('requestMasterDelete("PRODUCT"');
    expect(masterDataTables).not.toContain("tabIndex={0}");
    expect(masterDataTables).not.toContain("onClick={() => selectGateForEditing(gate.id)}");
  });
});
