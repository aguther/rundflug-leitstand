// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAdminMasterDataTable } from "./useAdminMasterDataTable";

function gate(id: string, label: string) {
  return {
    id,
    label,
    gateType: "BOARDING",
    active: true,
    sortOrder: Number(id.replace(/\D/g, "")),
  } as OperationBoard["gates"][number];
}

const board = {
  gates: Array.from({ length: 12 }, (_, index) => gate(`gate-${index + 1}`, `Gate ${index + 1}`)),
  resourceGroups: [
    {
      id: "group-active",
      name: "Panorama",
      shortCode: "PAN",
      gateLabel: "Gate 1",
      status: "ACTIVE",
      referenceCapacity: 4,
      activeAircraftIds: ["aircraft-a"],
    },
    {
      id: "group-paused",
      name: "Classic",
      shortCode: "CLA",
      gateLabel: "Gate 2",
      status: "PAUSED",
      referenceCapacity: 3,
      activeAircraftIds: [],
    },
  ],
  aircraft: [],
  pilots: [],
  products: [
    { id: "product-z", code: "Z-1", name: "Zulu" },
    { id: "product-a", code: "A-1", name: "Alpha" },
  ],
} as unknown as OperationBoard;

afterEach(cleanup);

describe("admin master-data table state", () => {
  it("paginates filtered rows and resets the page when the search changes", () => {
    const view = renderHook(() => useAdminMasterDataTable({ board, category: "gates" }));

    act(() => view.result.current.setPage(1));
    expect(view.result.current.clampedPage).toBe(1);
    expect(view.result.current.pagedGates).toHaveLength(2);

    act(() => view.result.current.setSearch("Gate 12"));

    expect(view.result.current.clampedPage).toBe(0);
    expect(view.result.current.filteredCount).toBe(1);
    expect(view.result.current.pagedGates[0]?.id).toBe("gate-12");
  });

  it("cycles category-local sorting with numeric-aware labels", () => {
    const sortingBoard = {
      ...board,
      gates: [gate("gate-10", "Gate 10"), gate("gate-2", "Gate 2")],
    } as OperationBoard;
    const view = renderHook(() =>
      useAdminMasterDataTable({ board: sortingBoard, category: "gates" }),
    );

    act(() => view.result.current.toggleSort("label"));
    expect(view.result.current.pagedGates.map((entry) => entry.label)).toEqual([
      "Gate 2",
      "Gate 10",
    ]);

    act(() => view.result.current.toggleSort("label"));
    expect(view.result.current.pagedGates.map((entry) => entry.label)).toEqual([
      "Gate 10",
      "Gate 2",
    ]);

    act(() => view.result.current.toggleSort("label"));
    expect(view.result.current.sort.direction).toBeNull();
  });

  it("filters resource status and keeps products alphabetically available for selectors", () => {
    const view = renderHook(() => useAdminMasterDataTable({ board, category: "resource-groups" }));

    act(() => view.result.current.setResourceStatusFilter("PAUSED"));

    expect(view.result.current.filteredCount).toBe(1);
    expect(view.result.current.pagedResourceGroups[0]?.id).toBe("group-paused");
    expect(view.result.current.alphabeticalProducts.map((product) => product.name)).toEqual([
      "Alpha",
      "Zulu",
    ]);
  });
});
