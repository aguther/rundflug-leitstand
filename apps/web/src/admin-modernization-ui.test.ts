import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminUxSource from "./admin-ux.tsx?raw";
import adminViewSource from "./admin-view.tsx?raw";
import accountSource from "./features/auth/AccountManagement.tsx?raw";
import planSource from "./features/operations/OperationalPlanPanel.tsx?raw";

const styles = readFileSync(
  new URL("./features/admin/admin-modernization.css", import.meta.url),
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
    expect(adminViewSource).toContain("<OperationalPlanPanel");
    expect(adminViewSource).toContain('mode="admin"');
    expect(adminViewSource).toContain('type: "UPSERT_PLANNED_OPERATION"');
    expect(adminViewSource).toContain('type: "CANCEL_PLANNED_OPERATION"');
    expect(planSource).toContain('mode === "flight-director" && onConfirm');
    expect(planSource).toContain("Bestätigung durch Flight Director");
    expect(planSource).toContain("Planeintrag wirklich absagen?");
    expect(planSource).not.toContain("{plan.reason}");
    expect(planSource).not.toContain("Interner Grund");
    expect(planSource).not.toContain("planReason");
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
