// @vitest-environment jsdom
import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AircraftProductTurnaroundOverrideDialog } from "./AircraftProductTurnaroundOverrideDialog";
import { AircraftResourceGroupAssignmentDialog } from "./AircraftResourceGroupAssignmentDialog";

const board = {
  aircraft: [
    {
      id: "aircraft-a",
      registration: "D-TEST",
      resourceGroupId: "group-a",
      resourceGroupName: "Gruppe A",
    },
  ],
  resourceGroups: [
    { id: "group-a", name: "Gruppe A", status: "ACTIVE" },
    { id: "group-b", name: "Gruppe B", status: "ACTIVE" },
  ],
  products: [
    {
      id: "product-a",
      code: "PAN20",
      name: "Panorama",
      effectiveTurnaroundProfile: {
        boarding: { valueMinutes: 8, sourceLevel: "EVENT" },
        deboarding: { valueMinutes: 5, sourceLevel: "EVENT" },
        buffer: { valueMinutes: 3, sourceLevel: "EVENT" },
      },
    },
  ],
  aircraftProductTurnaroundOverrides: [],
} as unknown as OperationBoard;

afterEach(cleanup);

describe("shared aircraft relationship dialogs", () => {
  it("confirms one aircraft-to-resource-group assignment", () => {
    const onConfirm = vi.fn();
    render(
      <AircraftResourceGroupAssignmentDialog
        board={board}
        busy={false}
        context={{ mode: "aircraft", aircraftId: "aircraft-a" }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText("Neue Ressourcengruppe"), {
      target: { value: "group-b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zuordnung bestätigen" }));
    expect(onConfirm).toHaveBeenCalledWith("aircraft-a", "group-b");
  });

  it("only guards closing after the assignment selection changed", () => {
    const onClose = vi.fn();
    render(
      <AircraftResourceGroupAssignmentDialog
        board={board}
        busy={false}
        context={{ mode: "aircraft", aircraftId: "aircraft-a" }}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renders a usable discard confirmation for a changed assignment", () => {
    const onClose = vi.fn();
    render(
      <AircraftResourceGroupAssignmentDialog
        board={board}
        busy={false}
        context={{ mode: "aircraft", aircraftId: "aircraft-a" }}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Neue Ressourcengruppe"), {
      target: { value: "group-b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(
      screen.getByRole("alertdialog", { name: "Zuordnungsänderung verwerfen?" }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Auswahl verwerfen" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps an explicit zero distinct from inherited turnaround values", () => {
    const onSave = vi.fn();
    render(
      <AircraftProductTurnaroundOverrideDialog
        board={board}
        busyKey={null}
        context={{ mode: "aircraft", aircraftId: "aircraft-a" }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    const firstOverrideAction = screen.getAllByRole("button", {
      name: "Abweichung festlegen",
    })[0];
    expect(firstOverrideAction).toBeDefined();
    fireEvent.click(firstOverrideAction as HTMLButtonElement);
    fireEvent.change(screen.getByRole("spinbutton", { name: /Boarding in Minuten/ }), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Änderung speichern" }));
    expect(onSave).toHaveBeenCalledWith("aircraft-a", "product-a", {
      boarding: 0,
      deboarding: null,
      buffer: null,
    });
  });
});
