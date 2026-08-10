import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminUxSource from "./admin-ux.tsx?raw";
import accountSource from "./features/auth/AccountManagement.tsx?raw";
import planSource from "./features/operations/OperationalPlanPanel.tsx?raw";

const styles = readFileSync(
  new URL("./features/admin/admin-modernization.css", import.meta.url),
  "utf8",
);
const planStyles = readFileSync(
  new URL("./features/operations/operational-plan.css", import.meta.url),
  "utf8",
);

describe("modernized administration workspace", () => {
  it("keeps event tabs keyboard accessible with a fixed status slot", () => {
    expect(adminUxSource).toContain('role="tablist"');
    expect(adminUxSource).toContain('role="tab"');
    expect(adminUxSource).toContain('className="setup-step-status"');
    expect(adminUxSource).toContain("aria-selected={current}");
    expect(adminUxSource).toContain('"ArrowLeft"');
    expect(adminUxSource).toContain('"ArrowRight"');
    expect(adminUxSource).toContain('className="setup-step-status"');
  });

  it("exposes the shared plan in admin without operational confirmation controls", () => {
    expect(planSource).toContain('mode === "flight-director" && onConfirm');
    expect(planSource).toContain('content = "combined"');
    expect(planSource).toContain("Bestätigung durch Flight Director");
    expect(planSource).toContain("Planeintrag wirklich absagen?");
    expect(planSource).not.toContain("{plan.reason}");
    expect(planSource).not.toContain("Interner Grund");
    expect(planSource).not.toContain("planReason");
  });

  it("uses one isolated operational dialog with aligned localized time controls", () => {
    expect(planSource.match(/\sportal/g)).toHaveLength(2);
    expect(planStyles).toContain("grid-template-columns: minmax(0, 1fr) auto minmax(96px, 112px)");
    expect(planStyles).toContain(".operational-plan-dialog .localized-picker-control > input");
    expect(planStyles).toContain("background: var(--ui-control)");
    expect(planStyles).toMatch(
      /\.operational-plan-form-grid > \.ds-field \{[\s\S]*?align-content: start;[\s\S]*?margin-bottom: 0;/,
    );
    expect(planSource).toContain("Nach aktuellem Umlauf");
    expect(planSource).toContain("Kein aktueller Umlauf verfügbar");
    expect(planSource).toContain("Für einen späteren Zeitpunkt");
    expect(planSource).toContain("alle 5 Umläufe tanken");
    expect(planSource).toContain("Regel hinzufügen");
    expect(planSource).toContain("Umläufe bis zur Auslösung");
    expect(planSource).toContain("Betriebsminuten bis zur Auslösung");
    expect(planSource).toContain('className="operational-rule-trigger-value"');
    expect(planStyles).toMatch(
      /\.operational-plan-form-grid > \.operational-rule-trigger-value \{[\s\S]*?grid-template-rows: auto var\(--control-default\) minmax\(2\.05rem, auto\);/,
    );
  });

  it("uses a modal account table with explicit edit and protected delete actions", () => {
    expect(accountSource).toContain("<DataTable");
    expect(accountSource).toMatch(
      /className="account-table-toolbar"[\s\S]*?className="account-create-button"[\s\S]*?Konto hinzufügen/,
    );
    expect(accountSource).toContain('title="Konto hinzufügen"');
    expect(accountSource).toContain('title="Konto bearbeiten"');
    expect(accountSource).toContain("Sitzungen widerrufen");
    expect(accountSource).toContain("<Pencil");
    expect(accountSource).toContain("<Trash2");
    expect(accountSource).toContain('title="Konto löschen"');
    expect(accountSource).toContain("Das aktuell verwendete eigene Konto");
    expect(accountSource).toContain("Das letzte aktive Administrationskonto");
  });

  it("defines dedicated iPad landscape and portrait reductions without page overflow", () => {
    expect(styles).toContain("@media (min-width: 901px) and (max-width: 1199px)");
    expect(styles).toContain("@media (max-width: 900px)");
    expect(styles).toContain("grid-template-columns: 72px minmax(0, 1fr)");
    expect(styles).toContain("overflow-x: hidden");
    expect(styles).toContain('data-master-table="aircraft"');
  });
});
