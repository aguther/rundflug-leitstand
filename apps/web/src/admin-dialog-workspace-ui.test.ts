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
    expect(adminViewSource).toContain("adminWorkspaceScrollRef.current?.scrollTo({ top: 0 })");
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
      /\.admin-workspace:not\(\.master-data-active\) > \.setup-progress \{[\s\S]*?margin-bottom: 0;/,
    );
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
    expect(adminViewSource).toContain(
      'size={masterDataCategory === "resource-groups" ? "wide" : "default"}',
    );
    expect(adminViewSource).toMatch(
      /masterDataCategory === "pilots"[\s\S]*?size="default"[\s\S]*?Pilotencode/,
    );
    expect(adminEventStyles).toContain(".master-data-editor-dialog.ds-modal-dialog--wide");
    expect(adminEventStyles).toContain(".master-data-editor-dialog.ds-modal-dialog--default");
    expect(adminViewSource).toContain('className="master-editor-delete-footer"');
    expect(adminViewSource).toContain('className="master-editor-standard-actions"');
    expect(adminViewSource).toMatch(/>\s*Abbrechen\s*<\/Button>/);
    expect(adminViewSource).toMatch(/>\s*Speichern\s*<\/Button>/);
    expect(adminViewSource).toContain("<h3>Weitere Aktionen</h3>");
  });

  it("uses one shared, touch-sized checkbox row across master-data dialogs", () => {
    expect(adminViewSource.match(/<CheckboxField/g)).toHaveLength(5);
    expect(adminViewSource).toContain('label="Gate ist aktiv"');
    expect(adminViewSource).toContain('className="resource-automatic-precall"');
    expect(adminViewSource).toContain("<FieldHelp");
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

  it("keeps status, discard, delete, import and PIN flows in the shared modal language", () => {
    expect(adminViewSource).toContain('title="Änderungen verwerfen?"');
    expect(adminViewSource).toContain("Weiter bearbeiten");
    expect(adminViewSource).toContain("Endgültig löschen");
    expect(adminViewSource).toContain('initialFocusSelector="[data-master-delete-cancel]"');
    expect(adminViewSource).toContain('title="Stammdatenvorlage importieren"');
    expect(adminViewSource).toMatch(/>\s*Importieren\s*<\/Button>/);
    expect(adminViewSource).toContain('id="admin-pin-form"');
    expect(adminViewSource).toContain('initialFocusSelector="#admin-pin-input"');

    const pinDialogSource = adminViewSource.slice(
      adminViewSource.indexOf("{adminPinDialog ? ("),
      adminViewSource.indexOf("{pendingMasterDelete ? ("),
    );
    expect(pinDialogSource).toContain("<ModalDialog");
    expect(pinDialogSource).not.toContain('className="confirmation-dialog"');
    expect(pinDialogSource).not.toContain('className="modal-backdrop"');
  });
});
