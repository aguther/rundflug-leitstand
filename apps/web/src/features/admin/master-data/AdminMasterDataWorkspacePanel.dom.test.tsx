// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminMasterDataWorkspacePanel } from "./AdminMasterDataWorkspacePanel";

vi.mock("./MasterDataWorkspace", () => ({
  MasterDataWorkspace: ({ children, filters }: { children: ReactNode; filters?: ReactNode }) => (
    <div>
      {filters}
      {children}
    </div>
  ),
}));
vi.mock("./MasterDataPagination", () => ({ MasterDataPagination: () => null }));
vi.mock("../gates/GatesWorkspace", () => ({
  GatesWorkspace: ({ onDelete }: { onDelete: (id: string, label: string) => void }) => (
    <button onClick={() => onDelete("gate-a", "Gate A")} type="button">
      Delete gate
    </button>
  ),
}));
vi.mock("../pilots/PilotCodesWorkspace", () => ({
  PilotCodesWorkspace: ({ onDelete }: { onDelete: (id: string, label: string) => void }) => (
    <button onClick={() => onDelete("pilot-a", "P-01")} type="button">
      Delete pilot
    </button>
  ),
}));
vi.mock("../resource-groups/ResourceGroupsWorkspace", () => ({
  ResourceGroupsWorkspace: ({
    onAssign,
    onDelete,
  }: {
    onAssign: (id: string) => void;
    onDelete: (id: string, label: string) => void;
  }) => (
    <div>
      <button onClick={() => onAssign("group-a")} type="button">
        Assign group
      </button>
      <button onClick={() => onDelete("group-a", "Group A")} type="button">
        Delete group
      </button>
    </div>
  ),
}));
vi.mock("../aircraft/AircraftWorkspace", () => ({
  AircraftWorkspace: ({
    onAssign,
    onDelete,
    onTurnaround,
  }: {
    onAssign: (id: string) => void;
    onDelete: (id: string, label: string) => void;
    onTurnaround: (id: string) => void;
  }) => (
    <div>
      <button onClick={() => onAssign("aircraft-a")} type="button">
        Assign aircraft
      </button>
      <button onClick={() => onDelete("aircraft-a", "D-EAAA")} type="button">
        Delete aircraft
      </button>
      <button onClick={() => onTurnaround("aircraft-a")} type="button">
        Aircraft turnaround
      </button>
    </div>
  ),
}));
vi.mock("../products/ProductsWorkspace", () => ({
  ProductsWorkspace: ({
    onDelete,
    onSales,
    onTurnaround,
  }: {
    onDelete: (id: string, label: string) => void;
    onSales: (id: string) => void;
    onTurnaround: (id: string) => void;
  }) => (
    <div>
      <button onClick={() => onDelete("product-a", "Product A")} type="button">
        Delete product
      </button>
      <button onClick={() => onSales("product-a")} type="button">
        Product sales
      </button>
      <button onClick={() => onTurnaround("product-a")} type="button">
        Product turnaround
      </button>
    </div>
  ),
}));

const board = {
  event: { eventId: "synthetic-event" },
} as unknown as OperationBoard;

const presentation = {
  singularLabel: "Flugzeug",
} as never;

function renderPanel(category: "aircraft" | "gates" | "pilots" | "products" | "resource-groups") {
  const onDelete = vi.fn();
  const onOpenAssignment = vi.fn();
  const onOpenSales = vi.fn();
  const onOpenTurnaround = vi.fn();
  const setResourceStatusFilter = vi.fn();
  const view = render(
    <AdminMasterDataWorkspacePanel
      board={board}
      category={category}
      emptyState={<div>Empty</div>}
      eventStep={category}
      onDelete={onDelete}
      onEdit={{
        aircraft: vi.fn(),
        gates: vi.fn(),
        pilots: vi.fn(),
        products: vi.fn(),
        resourceGroups: vi.fn(),
      }}
      onNew={vi.fn()}
      onOpenAssignment={onOpenAssignment}
      onOpenSales={onOpenSales}
      onOpenTurnaround={onOpenTurnaround}
      presentation={presentation}
      table={
        {
          clampedPage: 0,
          filteredCount: 1,
          pageSize: 10,
          pagedAircraft: [],
          pagedGates: [],
          pagedPilots: [],
          pagedProducts: [],
          pagedResourceGroups: [],
          resourceStatusFilter: "ALL",
          search: "",
          setPage: vi.fn(),
          setPageSize: vi.fn(),
          setResourceStatusFilter,
          setSearch: vi.fn(),
          sort: { category, direction: null },
          toggleSort: vi.fn(),
        } as never
      }
    />,
  );
  return {
    ...view,
    onDelete,
    onOpenAssignment,
    onOpenSales,
    onOpenTurnaround,
    setResourceStatusFilter,
  };
}

afterEach(cleanup);

describe("admin master-data workspace panel", () => {
  it("maps aircraft row actions to typed workspace boundaries", () => {
    const actions = renderPanel("aircraft");

    fireEvent.click(screen.getByRole("button", { name: "Assign aircraft" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete aircraft" }));
    fireEvent.click(screen.getByRole("button", { name: "Aircraft turnaround" }));

    expect(actions.onOpenAssignment).toHaveBeenCalledWith({
      aircraftId: "aircraft-a",
      mode: "aircraft",
    });
    expect(actions.onDelete).toHaveBeenCalledWith("AIRCRAFT", "aircraft-a", "D-EAAA");
    expect(actions.onOpenTurnaround).toHaveBeenCalledWith({
      aircraftId: "aircraft-a",
      mode: "aircraft",
    });
  });

  it("maps product actions without duplicating sales state", () => {
    const actions = renderPanel("products");

    fireEvent.click(screen.getByRole("button", { name: "Product sales" }));
    fireEvent.click(screen.getByRole("button", { name: "Product turnaround" }));

    expect(actions.onOpenSales).toHaveBeenCalledWith("product-a");
    expect(actions.onOpenTurnaround).toHaveBeenCalledWith({
      mode: "product",
      productId: "product-a",
    });
  });

  it("maps every row deletion to its explicit entity type", () => {
    const scenarios = [
      ["gates", "Delete gate", ["GATE", "gate-a", "Gate A"]],
      ["resource-groups", "Delete group", ["RESOURCE_GROUP", "group-a", "Group A"]],
      ["pilots", "Delete pilot", ["PILOT", "pilot-a", "P-01"]],
      ["products", "Delete product", ["PRODUCT", "product-a", "Product A"]],
    ] as const;

    for (const [category, buttonName, expected] of scenarios) {
      const actions = renderPanel(category);
      fireEvent.click(screen.getByRole("button", { name: buttonName }));
      expect(actions.onDelete).toHaveBeenCalledWith(...expected);
      actions.unmount();
    }
  });

  it("keeps the resource status filter bound to table state", () => {
    const actions = renderPanel("resource-groups");

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "PAUSED" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Assign group" }));

    expect(actions.setResourceStatusFilter).toHaveBeenCalledWith("PAUSED");
    expect(actions.onOpenAssignment).toHaveBeenCalledWith({
      mode: "resource-group",
      resourceGroupId: "group-a",
    });
  });
});
