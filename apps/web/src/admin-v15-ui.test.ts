import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminUxSource from "./admin-ux.tsx?raw";
import apiSource from "./api.ts?raw";
import chartSource from "./features/admin/AdminEventFlowChart.tsx?raw";
import aircraftWorkspaceSource from "./features/admin/aircraft/AircraftWorkspace.tsx?raw";
import eventLogoEditorSource from "./features/admin/EventLogoEditor.tsx?raw";
import gatesWorkspaceSource from "./features/admin/gates/GatesWorkspace.tsx?raw";
import pilotWorkspaceSource from "./features/admin/pilots/PilotCodesWorkspace.tsx?raw";
import productsWorkspaceSource from "./features/admin/products/ProductsWorkspace.tsx?raw";
import resourceWorkspaceSource from "./features/admin/resource-groups/ResourceGroupsWorkspace.tsx?raw";

const adminStyles = readFileSync(
  new URL("./features/admin/admin-v15.css", import.meta.url),
  "utf8",
);
const adminEventStyles = readFileSync(
  new URL("./features/admin/admin-event-workspace.css", import.meta.url),
  "utf8",
);
const masterDataStyles = readFileSync(
  new URL("./features/admin/master-data/master-data.css", import.meta.url),
  "utf8",
);
const operationsStyles = readFileSync(
  new URL("./features/admin/operations/operations-workspace.css", import.meta.url),
  "utf8",
);
const productSalesStyles = readFileSync(
  new URL("./features/admin/products/product-sales-dialog.css", import.meta.url),
  "utf8",
);

describe("V1.5 administration UI", () => {
  it("supports SVG branding and consistent Pilotencode terminology", () => {
    expect(eventLogoEditorSource).toContain("image/svg+xml");
    expect(eventLogoEditorSource).toContain("PNG, JPEG, WebP oder sicheres SVG bis 1 MiB.");
    expect(eventLogoEditorSource).toContain("Logo für {themeLabel}");
    expect(apiSource).toMatch(/logo\?theme=\$\{theme\}/);
    expect(adminUxSource).toContain('{ id: "pilots", label: "Pilotencodes" }');
  });

  it("defines stable compact and phone layouts without page-level horizontal overflow", () => {
    expect(adminEventStyles).toContain(".setup-progress .setup-progress-item");
    expect(adminStyles).toContain("grid-template-columns: minmax(150px, 1fr) auto 112px");
    expect(adminEventStyles).toContain("overflow-x: auto");
    expect(adminEventStyles).toContain("scrollbar-width: none");
    expect(adminStyles).toContain("flex-direction: column");
  });

  it("keeps the event workspace dense and gives setup focus a stable footprint", () => {
    expect(adminEventStyles).not.toContain(".setup-progress li");
    expect(adminStyles).not.toContain(".setup-progress li");
    expect(adminStyles).not.toContain(".setup-step-number");
    expect(adminEventStyles).toContain(".setup-progress button:focus-visible");
    expect(adminEventStyles).toMatch(
      /\.setup-progress \.setup-progress-item,[\s\S]*?\.setup-progress button \{[\s\S]*?height: 54px;[\s\S]*?min-height: 54px;/,
    );
    expect(adminEventStyles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?height: 46px;[\s\S]*?min-height: 46px;/,
    );
    expect(adminEventStyles).toContain("height: auto");
    expect(adminEventStyles).toContain("width: min(880px, 100%)");
    expect(adminEventStyles).toContain("width: min(1024px, calc(100vw - 32px))");
    expect(adminEventStyles).toContain("width: min(680px, calc(100vw - 32px))");
    expect(adminEventStyles).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
    expect(adminEventStyles).toContain(".admin-shell .history-table-wrap");
    expect(adminEventStyles).toContain("min-height: 220px");
    expect(adminEventStyles).toContain(
      ".admin-shell .manifest-correction-grid > .manifest-reason-field",
    );
    expect(chartSource).toContain('<ResponsiveContainer height="100%" width="100%">');
    expect(adminUxSource).toContain("Vorherige Einrichtungsschritte anzeigen");
    expect(adminUxSource).toContain("Weitere Einrichtungsschritte anzeigen");
    expect(operationsStyles).toMatch(
      /\.operations-workspace-controls \.event-release-v15 \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?gap: 14px;/,
    );
    expect(operationsStyles).toMatch(
      /\.event-release-v15 > \.event-release-ready \{[\s\S]*?grid-template-columns: 20px minmax\(0, 1fr\);/,
    );
    expect(productSalesStyles).toMatch(
      /\.product-sales-dialog \.localized-input-field \{[\s\S]*?color: var\(--ui-muted\);[\s\S]*?font-size: 0\.74rem;/,
    );
    expect(productSalesStyles).toMatch(
      /\.product-sales-dialog \.localized-picker-control > input \{[\s\S]*?height: var\(--product-sales-control-height\);[\s\S]*?border: 1px solid var\(--ui-border-strong\);[\s\S]*?border-radius: var\(--radius-sm\);[\s\S]*?background: var\(--ui-control\);/,
    );
    expect(productSalesStyles).toMatch(
      /\.product-sales-dialog \.localized-picker-control > input:focus \{[\s\S]*?border-color: color-mix\(in srgb, var\(--ui-accent\) 72%, var\(--ui-border\)\);[\s\S]*?outline: 0;/,
    );
    expect(productSalesStyles).toMatch(
      /\.product-sales-dialog \.localized-date-time \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto minmax\(112px, 0\.6fr\);/,
    );
    expect(productSalesStyles).toMatch(
      /@media \(max-width: 520px\) \{[\s\S]*?\.product-sales-dialog \.localized-date-time > span \{[\s\S]*?display: inline-flex;/,
    );
    expect(productSalesStyles).toMatch(
      /\.product-sales-dialog \.ds-modal-body \{[\s\S]*?grid-auto-rows: max-content;[\s\S]*?align-content: start;/,
    );
    expect(productSalesStyles).toMatch(
      /\.product-sales-status \{[\s\S]*?grid-auto-rows: minmax\(76px, max-content\);/,
    );
    expect(productSalesStyles).toMatch(
      /@media \(max-width: 520px\) \{[\s\S]*?\.product-sales-status \{[\s\S]*?min-height: 386px;/,
    );
  });

  it("keeps the area header geometry stable on master-data steps", () => {
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
    expect(adminUxSource).toContain('aria-current={current ? "step" : undefined}');
    expect(adminUxSource).toContain('step.complete ? "complete" : "pending"');
  });

  it("implements the event-scoped information architecture", () => {
    for (const navigationItem of [
      '{ id: "overview", label: "Übersicht"',
      '{ id: "events", label: "Veranstaltungen"',
      '{ id: "users", label: "Konten"',
      '{ id: "evaluation", label: "Auswertung"',
      '{ id: "backup", label: "Sicherung & Reset"',
    ]) {
      expect(adminUxSource).toContain(navigationItem);
    }
  });

  it("uses event-only flow data and a strict preview-before-import workflow", () => {
    expect(chartSource).toContain("<ComposedChart");
    expect(chartSource).toContain("strokeWidth={1.75}");
    expect(chartSource).toContain('type="stepAfter"');
    expect(chartSource).not.toContain("<Tooltip");
    expect(chartSource).toContain("timeAtRatio(visibleDomain, ratio)");
    expect(chartSource).toContain("onMouseDownCapture={preventChartFocus}");
    expect(chartSource).toContain("isAnimationActive={false}");
    expect(chartSource).toContain("activeDot={false}");
    expect(chartSource).toContain("accessibilityLayer={false}");
    expect(chartSource).toContain("<ReferenceLine");
    expect(chartSource).toContain("soldTickets");
    expect(chartSource).toContain("completedTickets");
    expect(chartSource).toContain("openTickets");
    expect(apiSource).toContain("/flow");
    expect(apiSource).toContain("/master-data-template/validate");
    expect(apiSource).toContain("/master-data-template/import");
    expect(apiSource).toContain("/exports/simulation-plan.json");
  });

  it("uses explicit touch actions instead of clickable master-data rows", () => {
    const featureSources = [
      gatesWorkspaceSource,
      resourceWorkspaceSource,
      aircraftWorkspaceSource,
      pilotWorkspaceSource,
      productsWorkspaceSource,
    ].join("\n");

    expect(productsWorkspaceSource).toContain("Handbag");
    expect(productsWorkspaceSource).toContain("Verkauf für ");
    expect(productsWorkspaceSource).toContain("product.name");
    expect(gatesWorkspaceSource).toContain('className="admin-entity-primary gate-primary-cell"');
    expect(masterDataStyles).toMatch(
      /\.admin-shell \.gate-primary-cell \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/,
    );
    expect(masterDataStyles).toMatch(
      /\.admin-shell \.gate-primary-cell > strong \{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/,
    );
    expect(featureSources).toContain("<IconButton");
    expect(featureSources).not.toContain("table-overflow-action");
    expect(featureSources).not.toContain("tabIndex={0}");
  });
});
