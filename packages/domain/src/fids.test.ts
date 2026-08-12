import { describe, expect, it } from "vitest";
import {
  filterFidsRows,
  groupSharedFidsFlights,
  orderFidsRows,
  paginateFidsRows,
  parseFidsPage,
  partitionFidsRows,
  planFidsSplitCapacity,
} from "./fids";

type Row = {
  rowId: string;
  productId: string;
  gateId: string | null;
  status: string;
  departedAt: string | null;
};
const row = (
  rowId: string,
  status = "WAITING",
  productId = "p-1",
  gateId = "g-1",
  departedAt: string | null = null,
): Row => ({ rowId, productId, gateId, status, departedAt });

describe("FIDS paging", () => {
  it("accepts only safe one-based URL pages", () => {
    expect([null, "", "0", "-1", "1.5", "text", "1000"].map(parseFidsPage)).toEqual(
      Array(7).fill(1),
    );
    expect(parseFidsPage("12")).toBe(12);
    expect(parseFidsPage("999")).toBe(999);
  });

  it("does not clamp an empty requested page", () => {
    expect(paginateFidsRows([1, 2, 3, 4], 3, 2)).toEqual({
      requestedPage: 3,
      pageSize: 2,
      totalItems: 4,
      totalPages: 2,
      groups: [],
    });
  });
});

describe("FIDS filters", () => {
  const rows = [row("a", "WAITING", "p-1", "g-1"), row("b", "WAITING", "p-2", "g-2")];

  it("treats empty dimensions as all and combines selected dimensions with AND", () => {
    expect(filterFidsRows(rows, { productIds: [], gateIds: [] })).toEqual(rows);
    expect(filterFidsRows(rows, { productIds: ["p-1", "p-2"], gateIds: ["g-2"] })).toEqual([
      rows[1],
    ]);
    expect(filterFidsRows(rows, { productIds: ["p-1"], gateIds: ["g-2"] })).toEqual([]);
  });
});

describe("FIDS shared flights", () => {
  type SharedRow = Row & {
    activeRecall: { id: string } | null;
    bookingGroupLabels: string[];
    communicationNumber: number;
    productCode: string;
    sharedFlightKey: string | null;
    ticketLabels: string[];
  };
  const sharedRow = (
    rowId: string,
    communicationNumber: number,
    overrides: Partial<SharedRow> = {},
  ): SharedRow => ({
    ...row(rowId, "BOARDING"),
    activeRecall: null,
    bookingGroupLabels: [`G-PAN-${String(communicationNumber).padStart(4, "0")}`],
    communicationNumber,
    productCode: "PAN",
    sharedFlightKey: "rotation:one",
    ticketLabels: [`ticket-${communicationNumber}`],
    ...overrides,
  });

  it("groups at most three compatible booking groups before paging", () => {
    const grouped = groupSharedFidsFlights(
      [1, 2, 3, 4].map((number) => sharedRow(`row-${number}`, number)),
      true,
    );

    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.bookingGroupLabels).toEqual(["G-PAN-0001", "G-PAN-0002", "G-PAN-0003"]);
    expect(grouped[0]?.ticketLabels).toEqual(["ticket-1", "ticket-2", "ticket-3"]);
    expect(grouped[1]?.bookingGroupLabels).toEqual(["G-PAN-0004"]);
    expect(paginateFidsRows(grouped, 1, 1)).toMatchObject({ totalItems: 2, totalPages: 2 });
  });

  it("keeps shared row identifiers stable for non-BMP flight keys", () => {
    const grouped = groupSharedFidsFlights(
      [sharedRow("unicode", 1, { sharedFlightKey: "rotation:🛩️" })],
      true,
    );

    expect(grouped[0]?.rowId).toBe("fids-shared-4vozq61k12k8a");
  });

  it("keeps recalled, incompatible and unbound rows separate", () => {
    const rows = [
      sharedRow("recalled", 1, { activeRecall: { id: "recall" } }),
      sharedRow("other-product", 2, { productId: "p-2" }),
      sharedRow("other-gate", 3, { gateId: "g-2" }),
      sharedRow("other-status", 4, { status: "IN_FLIGHT" }),
      sharedRow("unbound", 5, { sharedFlightKey: null }),
    ];

    const grouped = groupSharedFidsFlights(rows, true);
    expect(grouped).toHaveLength(rows.length);
    expect(grouped[0]?.rowId).toBe("recalled");
    expect(grouped.at(-1)?.rowId).toBe("unbound");
    expect(grouped.map((entry) => entry.bookingGroupLabels)).toEqual(
      rows.map((entry) => entry.bookingGroupLabels),
    );
    expect(groupSharedFidsFlights(rows, false)).toEqual(rows);
  });

  it("keeps the shared row identity stable when another group joins its first chunk", () => {
    const first = groupSharedFidsFlights([sharedRow("one", 1)], true)[0];
    const expanded = groupSharedFidsFlights([sharedRow("one", 1), sharedRow("two", 2)], true)[0];

    expect(first?.rowId).toBe(expanded?.rowId);
  });

  it("orders recent departures directly after actionable rows", () => {
    const ordered = orderFidsRows([
      row("waiting"),
      row("departure-old", "COMPLETED", "p-1", "g-1", "2026-08-02T08:00:00.000Z"),
      row("prepare", "PREPARE"),
      row("boarding", "BOARDING"),
      row("departure-new", "IN_FLIGHT", "p-1", "g-1", "2026-08-02T08:01:00.000Z"),
    ]);

    expect(ordered.map((entry) => entry.rowId)).toEqual([
      "boarding",
      "departure-new",
      "departure-old",
      "prepare",
      "waiting",
    ]);
  });
});

describe("FIDS split projection", () => {
  it("orders actionable rows before recent departures and PREPARE", () => {
    const rows = [
      row("gate", "COME_TO_FLIGHT_LINE"),
      row("departure-old", "COMPLETED", "p-1", "g-1", "2026-08-02T08:00:00.000Z"),
      row("prepare-1", "PREPARE"),
      row("boarding", "BOARDING"),
      row("departure-new", "IN_FLIGHT", "p-1", "g-1", "2026-08-02T08:02:00.000Z"),
    ];
    const split = partitionFidsRows({
      rows,
      visibleRows: 5,
      priorityGroupCount: 5,
      lowerPage: 1,
    });
    expect(split.priority.groups.map((entry) => entry.rowId)).toEqual([
      "gate",
      "boarding",
      "departure-new",
      "departure-old",
      "prepare-1",
    ]);
  });

  it("extends priority capacity for recent departures and excludes them from lower paging", () => {
    const split = partitionFidsRows({
      rows: [
        row("boarding", "BOARDING"),
        row("departure", "LANDED", "p-1", "g-1", "2026-08-02T08:02:00.000Z"),
        row("prepare", "PREPARE"),
        row("waiting"),
      ],
      visibleRows: 5,
      priorityGroupCount: 1,
      lowerPage: 1,
    });
    expect(split.priority.effectiveCapacity).toBe(2);
    expect(split.priority.groups.map((entry) => entry.rowId)).toEqual(["boarding", "departure"]);
    expect(split.page.pageSize).toBe(3);
    expect(split.page.groups.map((entry) => entry.rowId)).toEqual(["prepare", "waiting"]);
  });

  it("fills only remaining reserved priority places with PREPARE", () => {
    const split = partitionFidsRows({
      rows: [
        row("boarding", "BOARDING"),
        row("departure", "IN_FLIGHT", "p-1", "g-1", "2026-08-02T08:02:00.000Z"),
        row("prepare-1", "PREPARE"),
        row("prepare-2", "PREPARE"),
        row("waiting"),
      ],
      visibleRows: 5,
      priorityGroupCount: 3,
      lowerPage: 1,
    });
    expect(split.priority.groups.map((entry) => entry.rowId)).toEqual([
      "boarding",
      "departure",
      "prepare-1",
    ]);
    expect(split.priority.effectiveCapacity).toBe(3);
    expect(split.page.pageSize).toBe(2);
    expect(split.page.groups.map((entry) => entry.rowId)).toEqual(["prepare-2", "waiting"]);
  });

  it("reports hidden actionable and recent-departure overflow without leaking it below", () => {
    const rows = [
      row("boarding-1", "BOARDING"),
      row("boarding-2", "BOARDING"),
      row("boarding-3", "BOARDING"),
      row("departure-new", "IN_FLIGHT", "p-1", "g-1", "2026-08-02T08:03:00.000Z"),
      row("departure-old", "COMPLETED", "p-1", "g-1", "2026-08-02T08:01:00.000Z"),
      row("waiting"),
    ];
    const split = partitionFidsRows({
      rows,
      visibleRows: 4,
      priorityGroupCount: 2,
      lowerPage: 1,
    });
    expect(split.priority.groups.map((entry) => entry.rowId)).toEqual([
      "boarding-1",
      "boarding-2",
      "boarding-3",
      "departure-new",
    ]);
    expect(split.priority.overflowCount).toBe(1);
    expect(split.page.totalItems).toBe(1);
    expect(split.page.groups).toEqual([]);
    expect(
      new Set([...split.priority.groups, ...split.page.groups].map((entry) => entry.rowId)).size,
    ).toBe(split.priority.groups.length + split.page.groups.length);
  });

  it("redistributes capacity deterministically after an expired departure leaves the input", () => {
    const rows = [
      row("boarding", "BOARDING"),
      row("departure", "IN_FLIGHT", "p-1", "g-1", "2026-08-02T08:02:00.000Z"),
      row("prepare-1", "PREPARE"),
      row("prepare-2", "PREPARE"),
      row("waiting"),
    ];
    const before = partitionFidsRows({
      rows,
      visibleRows: 5,
      priorityGroupCount: 3,
      lowerPage: 1,
    });
    const after = partitionFidsRows({
      rows: rows.filter((entry) => entry.rowId !== "departure"),
      visibleRows: 5,
      priorityGroupCount: 3,
      lowerPage: 1,
    });
    expect(before.priority.groups.map((entry) => entry.rowId)).toEqual([
      "boarding",
      "departure",
      "prepare-1",
    ]);
    expect(after.priority.groups.map((entry) => entry.rowId)).toEqual([
      "boarding",
      "prepare-1",
      "prepare-2",
    ]);
    expect(after.page.groups.map((entry) => entry.rowId)).toEqual(["waiting"]);
  });

  it("plans mandatory upper capacity without depending on row content", () => {
    expect(
      planFidsSplitCapacity({
        visibleRows: 8,
        priorityGroupCount: 3,
        actionableCount: 2,
        recentDepartureCount: 3,
      }),
    ).toEqual({
      actionableLimit: 2,
      recentDepartureLimit: 3,
      prepareLimit: 0,
      effectivePriorityCapacity: 5,
      lowerPageSize: 3,
      overflowCount: 0,
    });
    expect(
      planFidsSplitCapacity({
        visibleRows: 4,
        priorityGroupCount: 2,
        actionableCount: 5,
        recentDepartureCount: 2,
      }),
    ).toMatchObject({
      actionableLimit: 4,
      recentDepartureLimit: 0,
      prepareLimit: 0,
      effectivePriorityCapacity: 4,
      lowerPageSize: 0,
      overflowCount: 3,
    });
  });
});
