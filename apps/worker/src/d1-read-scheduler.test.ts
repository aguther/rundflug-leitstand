import { describe, expect, it, vi } from "vitest";
import { d1All, d1First, runD1ReadsInBatch, runD1ReadsSequentially } from "./d1-read-scheduler";

describe("D1 read batch scheduler", () => {
  it("loads all and first projections in exactly one database batch", async () => {
    const statements = [{ id: "all" }, { id: "first" }] as unknown as readonly [
      D1PreparedStatement,
      D1PreparedStatement,
    ];
    const batch = vi.fn(async (received: D1PreparedStatement[]) => {
      expect(received).toEqual(statements);
      return [
        { results: [{ id: "a" }, { id: "b" }] },
        { results: [{ count: 7 }] },
      ] as D1Result<unknown>[];
    });
    const database = { batch } as unknown as D1Database;

    const [rows, first] = await runD1ReadsInBatch(database, [
      d1All<{ id: string }>(statements[0]),
      d1First<{ count: number }>(statements[1]),
    ] as const);

    expect(batch).toHaveBeenCalledOnce();
    expect(rows.results).toEqual([{ id: "a" }, { id: "b" }]);
    expect(first).toEqual({ count: 7 });
  });

  it("keeps compatibility reads sequential", async () => {
    let active = 0;
    let maximumActive = 0;
    const completionOrder: number[] = [];
    const tasks = Array.from({ length: 9 }, (_, index) => async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      completionOrder.push(index);
      active -= 1;
      return index;
    });

    const results = await runD1ReadsSequentially(tasks);

    expect(maximumActive).toBe(1);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(completionOrder).toEqual(results);
  });
});
