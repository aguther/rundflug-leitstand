import type { FidsBoardRow, FidsPreferences } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import type { SimulationFidsBoard } from "../forecast-simulation/simulation-fids";
import { createSimulationFidsDataSource } from "./simulation-fids-data-source";

const row = (
  index: number,
  status: FidsBoardRow["status"],
  productId = "product-a",
  gateId = "gate-a",
  departedAt: string | null = null,
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
  departedAt,
  status,
  waitLowerMinutes: 0,
  waitUpperMinutes: 30,
  boardingWindowLowerAt: "2026-08-02T08:00:00.000Z",
  boardingWindowUpperAt: "2026-08-02T08:30:00.000Z",
  forecastState: "DISPATCH_WINDOW",
  forecastReason: null,
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
  groupSharedFlights: false,
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

  it("keeps recent departures above PREPARE with identical live paging metadata", async () => {
    const recentBoard: SimulationFidsBoard = {
      ...board,
      groups: [
        row(1, "BOARDING"),
        row(2, "COME_TO_FLIGHT_LINE"),
        row(8, "COMPLETED", "product-a", "gate-a", "2026-08-02T08:01:00.000Z"),
        row(9, "IN_FLIGHT", "product-a", "gate-a", "2026-08-02T08:03:00.000Z"),
        row(3, "PREPARE", "product-b"),
        row(4, "WAITING"),
        row(5, "WAITING"),
      ],
    };
    const current = preferences({ viewMode: "SPLIT", visibleRows: 6, priorityGroupCount: 3 });
    const dataSource = createSimulationFidsDataSource({
      board: recentBoard,
      preferences: current,
      onPreferencesChanged: vi.fn(),
    });

    const response = await dataSource.loadBoard({ page: 1, lowerPage: 1 });

    expect(response.priority?.groups.map((entry) => entry.rowId)).toEqual([
      "row-1",
      "row-2",
      "row-9",
      "row-8",
    ]);
    expect(response.priority).toMatchObject({ effectiveCapacity: 4, overflowCount: 0 });
    expect(response.page).toMatchObject({
      requestedPage: 1,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
    });
    expect(response.page.groups.map((entry) => entry.rowId)).toEqual(["row-3", "row-4"]);
    expect(response.page.groups.every((entry) => entry.status !== "IN_FLIGHT")).toBe(true);
    expect(response.page.groups.every((entry) => entry.status !== "COMPLETED")).toBe(true);
    expect(
      new Set([
        ...(response.priority?.groups.map((entry) => entry.rowId) ?? []),
        ...response.page.groups.map((entry) => entry.rowId),
      ]).size,
    ).toBe((response.priority?.groups.length ?? 0) + response.page.groups.length);
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

  it("groups compatible shared flights before simulation paging when enabled", async () => {
    const sharedBoard: SimulationFidsBoard = {
      ...board,
      groups: [1, 2, 3, 4].map((number) => ({
        ...row(number, "BOARDING"),
        bookingGroupLabels: [`G-PAN-${String(number).padStart(4, "0")}`],
        sharedFlightKey: "rotation:shared",
      })),
    };
    const current = preferences({ groupSharedFlights: true });
    const dataSource = createSimulationFidsDataSource({
      board: sharedBoard,
      preferences: current,
      onPreferencesChanged: vi.fn(),
    });

    const response = await dataSource.loadBoard({ page: 1, lowerPage: 1 });

    expect(response.page).toMatchObject({ totalItems: 2, totalPages: 1 });
    expect(response.page.groups[0]?.bookingGroupLabels).toEqual([
      "G-PAN-0001",
      "G-PAN-0002",
      "G-PAN-0003",
    ]);
    expect(response.page.groups[1]?.bookingGroupLabels).toEqual(["G-PAN-0004"]);
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
