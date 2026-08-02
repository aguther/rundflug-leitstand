import type { FidsBoardRow, FidsPreferences } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import type { SimulationFidsBoard } from "../forecast-simulation/simulation-fids";
import { createSimulationFidsDataSource } from "./simulation-fids-data-source";

const row = (
  index: number,
  status: FidsBoardRow["status"],
  productId = "product-a",
  gateId = "gate-a",
): FidsBoardRow => ({
  rowId: `row-${index}`,
  productId,
  gateId,
  productName: productId === "product-a" ? "Panorama" : "Oldtimer",
  productCode: productId === "product-a" ? "PAN" : "OT",
  gateLabel: gateId === "gate-a" ? "Gate A" : "Gate B",
  communicationNumber: index,
  ticketLabels: [`${index}/1`],
  aircraftRegistration: null,
  departedAt: null,
  status,
  waitLowerMinutes: 0,
  waitUpperMinutes: 30,
  boardingWindowLowerAt: "2026-08-02T08:00:00.000Z",
  boardingWindowUpperAt: "2026-08-02T08:30:00.000Z",
  dispatchOrder: index,
  predictionQuality: "STABLE",
  operationalNotice: "",
  activeRecall: null,
});

const board: SimulationFidsBoard = {
  eventName: "Simulierter Flugtag",
  timeZone: "Europe/Berlin",
  selectedGate: null,
  emergencyMode: false,
  operationalInterrupted: false,
  operationalNotice: "",
  departedVisibilitySeconds: 15,
  updatedAt: "2026-08-02T08:00:00.000Z",
  groups: [
    row(1, "BOARDING"),
    row(2, "COME_TO_FLIGHT_LINE", "product-a", "gate-b"),
    row(3, "PREPARE", "product-b"),
    row(4, "WAITING"),
    row(5, "WAITING"),
    row(6, "WAITING"),
    row(7, "WAITING"),
  ],
  fleet: [],
};

const preferences = (overrides: Partial<FidsPreferences> = {}): FidsPreferences => ({
  visibleRows: 4,
  layout: "SINGLE",
  theme: "DARK",
  viewMode: "FIXED_PAGE",
  priorityGroupCount: 2,
  rotationIntervalSeconds: 12,
  contentFilter: { productIds: [], gateIds: [] },
  version: 4,
  ...overrides,
});

function source(current: FidsPreferences, changed = vi.fn()) {
  return {
    changed,
    dataSource: createSimulationFidsDataSource({
      board,
      preferences: current,
      onPreferencesChanged: changed,
    }),
  };
}

describe("simulation FIDS data source", () => {
  it("serves a stable fixed page from the complete simulation board", async () => {
    const { dataSource } = source(preferences());
    const response = await dataSource.loadBoard({ page: 2, lowerPage: 1 });

    expect(response.viewMode).toBe("FIXED_PAGE");
    expect(response.priority).toBeNull();
    expect(response.page).toMatchObject({
      requestedPage: 2,
      pageSize: 4,
      totalItems: 7,
      totalPages: 2,
    });
    expect(response.page.groups.map((entry) => entry.rowId)).toEqual(["row-5", "row-6", "row-7"]);
  });

  it("uses the shared split partition without duplicating priority rows", async () => {
    const { dataSource } = source(preferences({ viewMode: "SPLIT" }));
    const response = await dataSource.loadBoard({ page: 1, lowerPage: 2 });

    expect(response.priority?.groups.map((entry) => entry.rowId)).toEqual(["row-1", "row-2"]);
    expect(response.page).toMatchObject({ requestedPage: 2, pageSize: 2, totalItems: 5 });
    expect(response.page.groups.map((entry) => entry.rowId)).toEqual(["row-5", "row-6"]);
    expect(response.page.groups).not.toContainEqual(response.priority?.groups[0]);
  });

  it("applies product OR and gate AND filters before simulation paging", async () => {
    const { dataSource } = source(
      preferences({
        contentFilter: { productIds: ["product-a"], gateIds: ["gate-a"] },
      }),
    );
    const response = await dataSource.loadBoard({ page: 1, lowerPage: 1 });

    expect(response.page.totalItems).toBe(5);
    expect(response.page.groups.map((entry) => entry.rowId)).toEqual([
      "row-1",
      "row-4",
      "row-5",
      "row-6",
    ]);
  });

  it("keeps simulation preference persistence local and version checked", async () => {
    const current = preferences();
    const { dataSource, changed } = source(current);
    const { version: _version, ...editable } = current;

    await expect(dataSource.savePreferences(editable, 3)).rejects.toThrow(
      "zwischenzeitlich geändert",
    );
    const saved = await dataSource.savePreferences({ ...editable, theme: "LIGHT" }, 4);
    expect(saved).toMatchObject({ theme: "LIGHT", version: 5 });
    expect(changed).toHaveBeenCalledWith(saved);
  });
});
