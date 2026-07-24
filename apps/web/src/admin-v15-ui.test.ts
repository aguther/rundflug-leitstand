import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminUxSource from "./admin-ux.tsx?raw";
import adminViewSource from "./admin-view.tsx?raw";
import apiSource from "./api.ts?raw";
import chartSource from "./features/admin/AdminEventFlowChart.tsx?raw";

const adminStyles = readFileSync(
  new URL("./features/admin/admin-v15.css", import.meta.url),
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
    expect(adminViewSource).toContain("image/svg+xml");
    expect(adminViewSource).toContain("PNG, JPEG, WebP oder sicheres SVG bis 1 MiB.");
    expect(adminUxSource).toContain('{ id: "pilots", label: "Pilotencodes" }');
  });

  it("defines stable compact and phone layouts without page-level horizontal overflow", () => {
    expect(adminStyles).toContain("grid-template-columns: repeat(6, minmax(110px, 1fr))");
    expect(adminStyles).toContain("grid-template-columns: minmax(150px, 1fr) auto 112px");
    expect(adminStyles).toContain("overflow-x: auto");
    expect(adminStyles).toContain("scrollbar-width: none");
    expect(adminStyles).toContain("flex-direction: column");
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
    expect(adminViewSource).toContain("Vorlage importieren");
    expect(adminViewSource).toContain("templateValidation.counts");
    expect(adminViewSource).toContain('size="wide"');
  });

  it("opens master-data editors from rows without a redundant actions column", () => {
    const masterDataTables = adminViewSource.slice(
      adminViewSource.indexOf('<section className="master-data-workspace"'),
      adminViewSource.indexOf('hidden={eventStep !== "completion"}'),
    );

    expect(masterDataTables).not.toContain("<th>Aktionen</th>");
    expect(masterDataTables).not.toContain("table-overflow-action");
    expect(masterDataTables).toContain("onClick={() => selectGateForEditing(gate.id)}");
    expect(masterDataTables).toContain("onClick={() => selectResourceForEditing(group.id)}");
    expect(masterDataTables).toContain("onClick={() => selectAircraftForEditing(aircraft.id)}");
    expect(masterDataTables).toContain("onClick={() => selectPilotForEditing(pilot.id)}");
    expect(masterDataTables).toContain("onClick={() => selectProductForEditing(product.id)}");
  });
});
