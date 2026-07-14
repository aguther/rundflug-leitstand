import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_GATE_DISPLAY_FILTER_JSON,
  withGateDisplayFilterFallback,
} from "./gate-display-filter-storage";

describe("gate display filter migration compatibility", () => {
  it("falls back to the show-all filter only when the additive column is still missing", async () => {
    const query = vi.fn(async (mode: "current" | "legacy") => {
      if (mode === "current") {
        throw new Error("D1_ERROR: no such column: g.display_filter_json at offset 42");
      }
      return EMPTY_GATE_DISPLAY_FILTER_JSON;
    });

    await expect(withGateDisplayFilterFallback(query)).resolves.toBe(
      '{"productIds":[],"rotationStatuses":[]}',
    );
    expect(query.mock.calls).toEqual([["current"], ["legacy"]]);
  });

  it("does not hide unrelated database failures", async () => {
    const failure = new Error("D1_ERROR: database is unavailable");
    const query = vi.fn(async () => {
      throw failure;
    });

    await expect(withGateDisplayFilterFallback(query)).rejects.toBe(failure);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
