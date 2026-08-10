import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminUxSource from "./admin-ux.tsx?raw";
import turnaroundDialogSource from "./features/admin/aircraft/AircraftProductTurnaroundOverrideDialog.tsx?raw";
import assignmentDialogSource from "./features/admin/aircraft/AircraftResourceGroupAssignmentDialog.tsx?raw";
import completionSource from "./features/admin/completion/CompletionWorkspace.tsx?raw";
import frameSource from "./features/admin/event-workspace/EventWorkspaceFrame.tsx?raw";
import masterDataSource from "./features/admin/master-data/MasterDataWorkspace.tsx?raw";
import operationalPlanSource from "./features/admin/operational-plan/OperationalPlanWorkspace.tsx?raw";
import operationsSource from "./features/admin/operations/OperationsWorkspace.tsx?raw";

const adminWorkspaceStyles = readFileSync(
  new URL("./features/admin/admin-event-workspace.css", import.meta.url),
  "utf8",
);
const frameStyles = readFileSync(
  new URL("./features/admin/event-workspace/event-workspace.css", import.meta.url),
  "utf8",
);

describe("event-scoped administration redesign", () => {
  it("uses one event frame with a stable outer width for every variant", () => {
    expect(frameSource).toContain('EventWorkspaceVariant = "form" | "master-data" | "wide"');
    expect(frameStyles).toContain("--event-workspace-max-width: 1640px");
    expect(frameStyles).not.toContain("--event-workspace-max-width: 1180px");
    expect(frameStyles).not.toContain("--event-workspace-max-width: 1520px");
    expect(adminWorkspaceStyles).toMatch(
      /\.admin-shell \.event-setup-v15\.single-panel \{[\s\S]*?margin: 0;/,
    );
    expect(masterDataSource).toContain('<EventWorkspaceFrame event={event} variant="master-data">');
    expect(operationsSource).toContain('<EventWorkspaceFrame event={board.event} variant="wide">');
    expect(completionSource).toContain('<EventWorkspaceFrame event={board.event} variant="wide">');
    expect(adminUxSource).toContain("id={`admin-event-step-");
    expect(adminUxSource).toContain("-tab`}");
    expect(adminUxSource).toContain("aria-controls={`admin-event-step-");
    expect(adminUxSource).toContain("-panel`}");
  });

  it("preserves resource-group memberships and uses one assignment command path", () => {
    expect(assignmentDialogSource).toContain("Wirksam ab Bestätigung");
    expect(assignmentDialogSource).not.toContain("Batch");
    expect(assignmentDialogSource).not.toContain("Aufheben");
  });

  it("keeps product inheritance component-specific and deletes the final empty override", () => {
    expect(turnaroundDialogSource).toContain('value !== ""');
    expect(turnaroundDialogSource).toContain('boarding === "" ? null : Number(boarding)');
  });

  it("keeps product sales outside operations and provides five gated completion tabs", () => {
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
  });

  it("provides an optional ninth operational-plan step and a simplified operation screen", () => {
    expect(adminUxSource).toContain('| "operational-plan"');
    expect(operationalPlanSource).toContain('label: "Einschränkungen"');
    expect(operationalPlanSource).toContain('label: "Wiederkehrende Regeln"');
    expect(operationsSource).toContain("release");
    expect(operationsSource).toContain("emergency");
    expect(operationsSource).toContain('className="operations-workspace-content"');
    expect(operationsSource).not.toContain("OperationalPlanPanel");
    expect(operationsSource).not.toContain("Tabs");
  });
});
