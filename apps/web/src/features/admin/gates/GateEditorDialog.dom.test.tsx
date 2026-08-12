// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { GateEditorDialog } from "./GateEditorDialog";
import { useGateEditorState } from "./useGateEditorState";

const gates = [
  {
    id: "gate-a",
    label: "Gate A",
    gateType: "FLIGHT_LINE",
    active: true,
    sortOrder: 10,
    travelLeadMinutes: 2,
    displayFilter: { productIds: [], rotationStatuses: [] },
    assignedResourceGroupIds: [],
  },
] as OperationBoard["gates"];

const products = [{ id: "product-a", name: "Panorama flight" }] as OperationBoard["products"];

const resourceGroups = [
  { id: "group-a", name: "Panorama queue", gateId: "gate-a" },
] as OperationBoard["resourceGroups"];

interface HarnessProps {
  initialTab?: "general" | "details";
  selectedId?: string;
  submitAttempted?: boolean;
}

function Harness({ initialTab = "general", selectedId, submitAttempted = false }: HarnessProps) {
  const editor = useGateEditorState(gates);
  const [tab, setTab] = useState<"general" | "details">(initialTab);
  useEffect(() => {
    if (selectedId) editor.select(selectedId);
  }, [editor.select, selectedId]);

  return (
    <GateEditorDialog
      editor={editor}
      footer={<button type="button">Speichern</button>}
      furtherActions={<button type="button">Weitere Aktionen</button>}
      initialFocusSelector="#gate-label"
      onClose={() => undefined}
      onTabChange={setTab}
      open
      products={products}
      resourceGroups={resourceGroups}
      submitAttempted={submitAttempted}
      tab={tab}
    />
  );
}

afterEach(cleanup);

describe("gate editor dialog", () => {
  it("presents the approved gate defaults in a wide dialog", () => {
    render(<Harness />);

    const dialog = screen.getByRole("dialog", { name: "Gate anlegen" });
    expect(dialog.classList.contains("ds-modal-dialog--wide")).toBe(true);
    expect((screen.getByLabelText("Gate ist aktiv") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Zusätzlicher Wegvorlauf") as HTMLInputElement).value).toBe("0");
  });

  it("edits display filters without mutating products or resource assignments", () => {
    render(<Harness initialTab="details" />);
    const productFilter = screen.getByLabelText("Panorama flight") as HTMLInputElement;

    fireEvent.click(productFilter);

    expect(productFilter.checked).toBe(true);
    expect(screen.getByRole("button", { name: /löst keine Zustandsänderung aus/ })).toBeTruthy();
    expect(products[0]?.name).toBe("Panorama flight");
    expect(resourceGroups[0]?.gateId).toBe("gate-a");
  });

  it("shows existing resource assignments as a read-only projection", async () => {
    render(<Harness initialTab="details" selectedId="gate-a" />);

    await screen.findByRole("dialog", { name: "Gate bearbeiten" });
    expect(screen.getByText("Panorama queue")).toBeTruthy();
    expect(screen.getByText(/Zuordnungen werden bei der Ressourcengruppe gepflegt/)).toBeTruthy();
  });

  it("keeps invalid-label guidance in the extracted dialog", () => {
    render(<Harness submitAttempted />);

    expect(screen.getByText(/Gate-Bezeichnung muss mindestens 2 Zeichen/)).toBeTruthy();
  });
});
