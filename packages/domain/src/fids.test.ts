import { describe, expect, it } from "vitest";
import { filterFidsRows, paginateFidsRows, parseFidsPage, partitionFidsRows } from "./fids";

type Row = { rowId: string; productId: string; gateId: string | null; status: string };
const row = (rowId: string, status = "WAITING", productId = "p-1", gateId = "g-1"): Row => ({
  rowId,
  productId,
  gateId,
  status,
});

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

describe("FIDS split projection", () => {
  it("keeps urgent groups above PREPARE, reserves capacity, and never duplicates rows", () => {
    const rows = [
      row("boarding", "BOARDING"),
      row("gate", "COME_TO_FLIGHT_LINE"),
      row("prepare-1", "PREPARE"),
      row("prepare-2", "PREPARE"),
      row("waiting-1"),
      row("waiting-2"),
    ];
    const split = partitionFidsRows({
      rows,
      visibleRows: 5,
      priorityGroupCount: 3,
      lowerPage: 1,
    });
    expect(split.priority.groups.map((entry) => entry.rowId)).toEqual([
      "boarding",
      "gate",
      "prepare-1",
    ]);
    expect(split.priority.effectiveCapacity).toBe(3);
    expect(split.page.pageSize).toBe(2);
    expect(split.page.groups.map((entry) => entry.rowId)).toEqual(["prepare-2", "waiting-1"]);
    expect(
      new Set([...split.priority.groups, ...split.page.groups].map((entry) => entry.rowId)).size,
    ).toBe(5);
  });

  it("expands for urgent groups and reports urgent overflow at full capacity", () => {
    const urgent = Array.from({ length: 6 }, (_, index) => row(`urgent-${index}`, "BOARDING"));
    const split = partitionFidsRows({
      rows: [...urgent, row("waiting")],
      visibleRows: 5,
      priorityGroupCount: 2,
      lowerPage: 1,
    });
    expect(split.priority.effectiveCapacity).toBe(5);
    expect(split.priority.groups).toHaveLength(5);
    expect(split.priority.totalItems).toBe(6);
    expect(split.priority.overflowCount).toBe(1);
    expect(split.page.pageSize).toBe(0);
    expect(split.page.groups).toEqual([]);
  });

  it("keeps the configured upper space reserved when fewer priority groups exist", () => {
    const split = partitionFidsRows({
      rows: [row("prepare", "PREPARE"), row("waiting")],
      visibleRows: 5,
      priorityGroupCount: 3,
      lowerPage: 1,
    });
    expect(split.priority.effectiveCapacity).toBe(3);
    expect(split.priority.groups).toHaveLength(1);
    expect(split.page.pageSize).toBe(2);
    expect(split.page.groups.map((entry) => entry.rowId)).toEqual(["waiting"]);
  });
});
