// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAircraftEditorState } from "../aircraft/useAircraftEditorState";
import { useResourceGroupEditorState } from "../resource-groups/useResourceGroupEditorState";
import { ResourceAircraftEditorDialog } from "./ResourceAircraftEditorDialog";

const board = {
  gates: [
    { id: "gate-a", label: "Gate A", active: true },
    { id: "gate-b", label: "Gate B", active: false },
  ],
  resourceGroups: [
    {
      id: "group-a",
      name: "Panorama queue",
      shortCode: "PA",
      gateId: "gate-a",
      automaticPrecallEnabled: false,
      referenceCapacity: 4,
    },
  ],
  aircraft: [
    {
      id: "aircraft-a",
      registration: "D-EXYZ",
      aircraftType: "Cessna 172",
      passengerSeats: 3,
      maximumPassengerPayloadKg: 245,
      operationalState: "AVAILABLE",
      resourceGroupName: "Panorama queue",
    },
  ],
  aircraftProductTurnaroundOverrides: [{ aircraftId: "aircraft-a", productId: "product-a" }],
} as OperationBoard;

interface HarnessProps {
  category: "resource-groups" | "aircraft";
  onAssignAircraft?: (resourceGroupId: string) => void;
  selectedId?: string;
  submitAttempted?: boolean;
}

function Harness({
  category,
  onAssignAircraft = () => undefined,
  selectedId,
  submitAttempted = false,
}: HarnessProps) {
  const resourceEditor = useResourceGroupEditorState(board);
  const aircraftEditor = useAircraftEditorState(board);

  useEffect(() => {
    if (!selectedId) return;
    if (category === "resource-groups") resourceEditor.select(selectedId);
    else aircraftEditor.select(selectedId);
  }, [aircraftEditor.select, category, resourceEditor.select, selectedId]);

  return (
    <ResourceAircraftEditorDialog
      aircraftEditor={aircraftEditor}
      board={board}
      category={category}
      footer={<button type="button">Speichern</button>}
      furtherActions={<button type="button">Weitere Aktionen</button>}
      initialFocusSelector={
        category === "resource-groups" ? "#resource-name" : "#aircraft-registration"
      }
      onAssignAircraft={onAssignAircraft}
      onClose={() => undefined}
      open
      resourceEditor={resourceEditor}
      submitAttempted={submitAttempted}
    />
  );
}

afterEach(cleanup);

describe("resource and aircraft editor dialog", () => {
  it("renders a new resource group with only active gate choices", () => {
    render(<Harness category="resource-groups" />);

    const dialog = screen.getByRole("dialog", { name: "Ressourcengruppe anlegen" });
    expect(dialog.classList.contains("ds-modal-dialog--wide")).toBe(true);
    expect(screen.getByRole("option", { name: "Gate A" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Gate B" })).toBeNull();
    expect(screen.getByText(/zuerst speichern/)).toBeTruthy();

    const automaticPrecall = screen.getByLabelText(
      "Automatischer Voraufruf für diese Gruppe",
    ) as HTMLInputElement;
    expect(automaticPrecall.checked).toBe(true);
    fireEvent.click(automaticPrecall);
    expect(automaticPrecall.checked).toBe(false);
  });

  it("opens assignment handling for the selected resource group", async () => {
    const onAssignAircraft = vi.fn();
    render(
      <Harness
        category="resource-groups"
        onAssignAircraft={onAssignAircraft}
        selectedId="group-a"
      />,
    );

    await screen.findByRole("dialog", { name: "Ressourcengruppe bearbeiten" });
    fireEvent.click(screen.getByRole("button", { name: "Flugzeug zuordnen" }));
    expect(onAssignAircraft).toHaveBeenCalledWith("group-a");
  });

  it("shows the selected aircraft operational projection", async () => {
    render(<Harness category="aircraft" selectedId="aircraft-a" />);

    const dialog = await screen.findByRole("dialog", { name: "Flugzeug bearbeiten" });
    expect(dialog.classList.contains("ds-modal-dialog--default")).toBe(true);
    expect(screen.getByText("Panorama queue")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByDisplayValue("245")).toBeTruthy();
  });

  it("keeps validation and normalized registration behavior in the extracted dialog", () => {
    render(<Harness category="aircraft" submitAttempted />);

    expect(screen.getByText(/Kennzeichen und Flugzeugtyp/)).toBeTruthy();
    const registration = screen.getByLabelText("Kennzeichen") as HTMLInputElement;
    fireEvent.change(registration, { target: { value: "d-efgh" } });
    expect(registration.value).toBe("D-EFGH");
  });
});
