import { describe, expect, it } from "vitest";
import {
  countFidsProjectionRows,
  type FidsProjectionRow,
  loadAllFidsProjectionRows,
  loadFidsProjectionRows,
} from "./fids-board-projection";
import projectionSource from "./fids-board-projection.ts?raw";

function recordingDatabase(result: { count?: number; rows?: FidsProjectionRow[] }): {
  db: D1Database;
  statements: string[];
  bindings: unknown[][];
} {
  const statements: string[] = [];
  const bindings: unknown[][] = [];
  const db = {
    prepare(statement: string) {
      statements.push(statement);
      return {
        bind(...values: unknown[]) {
          bindings.push(values);
          return {
            first: async () => ({ total_items: result.count ?? 0 }),
            all: async () => ({ results: result.rows ?? [] }),
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, statements, bindings };
}

const projectionInput = {
  eventId: "event-synthetic",
  filter: {
    productIds: ["product-b", "product-a"],
    gateIds: ["gate-a"],
    rotationStatuses: [],
  },
  departedVisibilityCutoff: "2026-08-02T08:00:00.000Z",
  now: "2026-08-02T08:00:15.000Z",
  band: "PREPARE" as const,
  excludedRowIds: ["rotation-a:group-a"],
};

describe("protected FIDS board projection", () => {
  it("applies event filters before ranking, counting and page limits", async () => {
    const projectedStart = projectionSource.indexOf("WITH projected AS");
    const rankedStart = projectionSource.indexOf("), ranked AS");
    const productFilter = projectionSource.indexOf("p.id IN (SELECT value FROM json_each(?2))");
    const gateFilter = projectionSource.indexOf("g.id IN (SELECT value FROM json_each(?3))");
    const selectedStart = projectionSource.indexOf("), selected AS");
    expect(projectedStart).toBeGreaterThanOrEqual(0);
    expect(productFilter).toBeGreaterThan(projectedStart);
    expect(gateFilter).toBeGreaterThan(productFilter);
    expect(rankedStart).toBeGreaterThan(gateFilter);
    expect(selectedStart).toBeGreaterThan(rankedStart);
    expect(projectionSource).toContain(
      "LEFT JOIN products p ON p.id = COALESCE(tg.product_id, fg.product_id)",
    );
    expect(projectionSource).toContain("LEFT JOIN booking_group_parts booking_part");

    const recording = recordingDatabase({ count: 17 });
    await expect(countFidsProjectionRows(recording.db, projectionInput)).resolves.toBe(17);
    expect(recording.statements[0]?.match(/\bWITH\b/g)).toHaveLength(1);
    expect(recording.statements[0]).toContain("WITH relevant_booking_group_rotations AS");
    expect(recording.statements[0]).toContain("booking_part.part_number");
    expect(recording.statements[0]).toContain("SELECT COUNT(*) AS total_items FROM selected");
    expect(recording.bindings[0]).toEqual([
      "event-synthetic",
      '["product-b","product-a"]',
      '["gate-a"]',
      "[]",
      "2026-08-02T08:00:00.000Z",
      "2026-08-02T08:00:15.000Z",
      "PREPARE",
      '["rotation-a:group-a"]',
    ]);
  });

  it("binds a bounded page after all projection filters", async () => {
    const recording = recordingDatabase({ rows: [] });
    await expect(
      loadFidsProjectionRows(recording.db, { ...projectionInput, limit: 8, offset: 16 }),
    ).resolves.toEqual([]);
    expect(recording.statements[0]).toContain("LIMIT ?9 OFFSET ?10");
    expect(recording.bindings[0]?.slice(-2)).toEqual([8, 16]);
  });

  it("loads the complete filtered projection before optional shared-flight grouping", async () => {
    const recording = recordingDatabase({ rows: [] });
    await expect(loadAllFidsProjectionRows(recording.db, projectionInput)).resolves.toEqual([]);
    expect(recording.statements[0]).not.toContain("LIMIT ?9 OFFSET ?10");
    expect(recording.bindings[0]?.[6]).toBe("PREPARE");
  });

  it("selects recent departures only inside the configured cutoff", async () => {
    const recording = recordingDatabase({ rows: [] });
    await loadFidsProjectionRows(recording.db, {
      ...projectionInput,
      band: "RECENT_DEPARTURE",
      limit: 8,
      offset: 0,
    });
    expect(recording.statements[0]).toContain("status IN ('IN_FLIGHT', 'LANDED', 'COMPLETED')");
    expect(recording.statements[0]).toContain(
      "r.status NOT IN ('IN_FLIGHT', 'LANDED', 'COMPLETED') OR r.departed_at > ?5",
    );
    expect(recording.statements[0]).toContain(
      "?7 = 'RECENT_DEPARTURE' AND recent_departure_band = 1",
    );
    expect(recording.bindings[0]?.[6]).toBe("RECENT_DEPARTURE");
  });

  it("categorically excludes actionable and recent-departure rows from lower paging", async () => {
    const recording = recordingDatabase({ count: 4 });
    await countFidsProjectionRows(recording.db, {
      ...projectionInput,
      band: "LOWER",
      excludedRowIds: ["selected-prepare"],
    });
    expect(recording.statements[0]).toContain(
      "?7 = 'LOWER' AND actionable_band = 0 AND recent_departure_band = 0",
    );
    expect(recording.bindings[0]?.[6]).toBe("LOWER");
    expect(recording.bindings[0]?.[7]).toBe('["selected-prepare"]');
  });

  it("keeps the ALL band ordering unchanged for the anonymous projection", async () => {
    const recording = recordingDatabase({ rows: [] });
    await loadFidsProjectionRows(recording.db, {
      ...projectionInput,
      band: "ALL",
      limit: 8,
      offset: 0,
    });
    expect(recording.statements[0]).toContain("?7 = 'ALL'");
    expect(recording.statements[0]).toMatch(
      /CASE WHEN status IN \('IN_FLIGHT', 'LANDED', 'COMPLETED'\)\s+THEN departed_at END DESC/,
    );
    expect(recording.bindings[0]?.[6]).toBe("ALL");
  });
});
