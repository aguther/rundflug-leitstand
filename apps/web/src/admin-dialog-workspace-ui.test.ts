import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminViewSource from "./admin-view.tsx?raw";

const adminEventStyles = readFileSync(
  new URL("./features/admin/admin-event-workspace.css", import.meta.url),
  "utf8",
);
const adminStyles = readFileSync(
  new URL("./features/admin/admin-v15.css", import.meta.url),
  "utf8",
);
const legacyStyles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("unified master-data dialogs and stable event workspace", () => {
  it("keeps the event header and setup navigation outside one internally scrolling step region", () => {
    const setupIndex = adminViewSource.indexOf("<SetupProgress");
    const scrollRegionIndex = adminViewSource.indexOf('className="admin-workspace-scroll-region"');

    expect(setupIndex).toBeGreaterThan(0);
    expect(scrollRegionIndex).toBeGreaterThan(setupIndex);
    expect(adminViewSource).toContain("ref={adminWorkspaceScrollRef}");
    expect(adminEventStyles).toMatch(
      /\.admin-shell \.admin-workspace-scroll-region \{[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/,
    );
    expect(adminEventStyles).toMatch(
      /\.admin-shell \.admin-workspace,[\s\S]*?flex-direction: column;[\s\S]*?overflow: hidden;/,
    );
    expect(adminEventStyles).toMatch(
      /\.admin-workspace:not\(\.master-data-active\)[\s\S]*?> \.admin-workspace-scroll-region \{[\s\S]*?padding-top: 16px;/,
    );
    expect(adminEventStyles).toMatch(
      /\.admin-workspace:not\(\.master-data-active\) > \.setup-progress-navigation \{[\s\S]*?margin-bottom: 0;/,
    );
    expect(adminEventStyles).toMatch(
      /\.admin-shell \.setup-progress-navigation \{[\s\S]*?margin: 16px 16px 12px;/,
    );
    expect(adminEventStyles).toContain(".setup-progress-navigation.is-overflowing");
    expect(adminEventStyles).toContain(".setup-progress-scroll--forward");
    expect(adminEventStyles).toMatch(/\.admin-shell \.reset-levels \{[\s\S]*?padding: 0 16px 8px;/);
  });

  it("lets the event table and selected row fill the panel without an unused vertical gutter", () => {
    expect(adminStyles).toMatch(
      /\.event-catalog-table-wrap \{[\s\S]*?width: 100%;[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: hidden;/,
    );
    expect(adminEventStyles).toMatch(
      /\.admin-shell \.admin-workspace > \.event-catalog-primary \{[\s\S]*?max-height: clamp\(190px, 32vh, 320px\);/,
    );
    expect(adminEventStyles).toMatch(
      /\.admin-shell \.event-catalog-primary > \.event-catalog-table-wrap \{[\s\S]*?overflow-y: auto;/,
    );
    expect(adminStyles).toMatch(
      /\.event-catalog-table \{[\s\S]*?width: max-content;[\s\S]*?min-width: 100%;/,
    );
    expect(adminStyles).toContain(".event-catalog-table tbody tr.is-current");
  });

  it("uses content-appropriate shared modal sizes and neutral editor actions", () => {
    expect(adminEventStyles).toContain(".master-data-editor-dialog.ds-modal-dialog--wide");
    expect(adminEventStyles).toContain(".master-data-editor-dialog.ds-modal-dialog--default");
    expect(adminViewSource).toContain('className="master-editor-delete-footer"');
    expect(adminViewSource).toContain('className="master-editor-standard-actions"');
    expect(adminViewSource).toMatch(/>\s*Abbrechen\s*<\/Button>/);
    expect(adminViewSource).toMatch(/>\s*Speichern\s*<\/Button>/);
    expect(adminViewSource).toContain("<h3>Weitere Aktionen</h3>");
  });

  it("uses shared touch-sized checkbox rows without direct aircraft membership editing", () => {
    expect(legacyStyles).toMatch(
      /\.resource-aircraft-selection \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(legacyStyles).toMatch(
      /\.gate-filter-options \{[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(180px, 1fr\)\);/,
    );
    expect(adminEventStyles).not.toMatch(
      /\.resource-aircraft-selection \{[^}]*grid-template-columns: repeat\(2,/,
    );
    expect(adminEventStyles).not.toContain(".resource-aircraft-selection .checkbox-label");
  });

  it("keeps the gate advanced controls on one shared input baseline", () => {
    expect(adminEventStyles).toMatch(
      /\.admin-shell \.master-data-editor-panel > \.master-editor-further-settings \{[\s\S]*?grid-column: 1 \/ -1;/,
    );
    expect(adminEventStyles).toMatch(
      /\.admin-shell \.master-editor-further-settings \.parameter-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?align-items: end;/,
    );
    expect(adminEventStyles).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*?\.admin-shell \.master-editor-further-settings \.parameter-grid \{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?align-items: stretch;/,
    );
  });

  it("keeps status and discard flows in the shared modal language", () => {
    expect(adminViewSource).toContain('title="Änderungen verwerfen?"');
    expect(adminViewSource).toContain("Weiter bearbeiten");
  });
});
