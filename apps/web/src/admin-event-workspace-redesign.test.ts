import { describe, expect, it } from "vitest";
import adminUxSource from "./admin-ux.tsx?raw";
import adminViewSource from "./admin-view.tsx?raw";
import turnaroundDialogSource from "./features/admin/aircraft/AircraftProductTurnaroundOverrideDialog.tsx?raw";
import assignmentDialogSource from "./features/admin/aircraft/AircraftResourceGroupAssignmentDialog.tsx?raw";
import completionSource from "./features/admin/completion/CompletionWorkspace.tsx?raw";
import frameSource from "./features/admin/event-workspace/EventWorkspaceFrame.tsx?raw";
import masterDataSource from "./features/admin/master-data/MasterDataWorkspace.tsx?raw";
import operationalPlanSource from "./features/admin/operational-plan/OperationalPlanWorkspace.tsx?raw";
import operationsSource from "./features/admin/operations/OperationsWorkspace.tsx?raw";

describe("event-scoped administration redesign", () => {
  it("uses one event frame with stable content width variants", () => {
    expect(frameSource).toContain('EventWorkspaceVariant = "form" | "master-data" | "wide"');
    expect(masterDataSource).toContain('<EventWorkspaceFrame event={event} variant="master-data">');
    expect(operationsSource).toContain('<EventWorkspaceFrame event={board.event} variant="wide">');
    expect(completionSource).toContain('<EventWorkspaceFrame event={board.event} variant="wide">');
    expect(adminUxSource).toContain("id={`admin-event-step-");
    expect(adminUxSource).toContain("-tab`}");
    expect(adminUxSource).toContain("aria-controls={`admin-event-step-");
    expect(adminUxSource).toContain("-panel`}");
  });

  it("preserves resource-group memberships and uses one assignment command path", () => {
    const saveResourceGroupSource = adminViewSource.slice(
      adminViewSource.indexOf("async function saveResourceGroup"),
      adminViewSource.indexOf("async function saveAircraft"),
    );
    expect(saveResourceGroupSource).not.toContain("aircraftIds");
    expect(adminViewSource.match(/type: "ASSIGN_AIRCRAFT_RESOURCE_GROUP"/g)).toHaveLength(1);
    expect(assignmentDialogSource).toContain("Wirksam ab Bestätigung");
    expect(assignmentDialogSource).not.toContain("Batch");
    expect(assignmentDialogSource).not.toContain("Aufheben");
  });

  it("keeps product inheritance component-specific and deletes the final empty override", () => {
    expect(turnaroundDialogSource).toContain('value !== ""');
    expect(turnaroundDialogSource).toContain('boarding === "" ? null : Number(boarding)');
    expect(adminViewSource).toContain('type: "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE"');
    expect(adminViewSource).toContain('type: "DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE"');
    expect(adminViewSource).toContain("expectedOverrideVersion: existing.version");
  });

  it("keeps product sales outside operations and provides five gated completion tabs", () => {
    expect(adminViewSource).toContain("<ProductSalesDialog");
    expect(operationsSource).not.toContain("Verkauf und Kapazität");
    for (const label of [
      "Tagesübersicht",
      "Betriebshistorie",
      "Prognosegüte",
      "Auditprotokoll",
      "Administrative Korrekturen",
    ]) {
      expect(completionSource).toContain(label);
    }
    expect(completionSource).toContain("Korrektur beginnen");
    expect(adminViewSource).toContain("historyFiltersByViewRef");
    expect(adminViewSource).not.toContain("Flotte, Tanken und Pausen");
  });

  it("provides an optional ninth operational-plan step and a simplified operation screen", () => {
    expect(adminUxSource).toContain('| "operational-plan"');
    expect(adminViewSource).toContain('id: "operational-plan"');
    expect(adminViewSource).toContain('label: "Betriebsplan"');
    expect(adminViewSource).toContain("setupSteps.slice(0, 6)");
    expect(adminViewSource).toContain("<OperationalPlanWorkspace");
    expect(operationalPlanSource).toContain('label: "Einschränkungen"');
    expect(operationalPlanSource).toContain('label: "Wiederkehrende Regeln"');
    expect(operationsSource).toContain("release");
    expect(operationsSource).toContain("emergency");
    expect(operationsSource).toContain('className="operations-workspace-content"');
    expect(adminViewSource).toContain('className="operations-emergency-action"');
    expect(adminViewSource).toContain(
      '<Panel className="admin-emergency-section" padding="compact">',
    );
    expect(operationsSource).not.toContain("OperationalPlanPanel");
    expect(operationsSource).not.toContain("Tabs");
  });
});
