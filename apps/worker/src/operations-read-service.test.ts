import { describe, expect, it, vi } from "vitest";
import { applyDemoSeed, createD1TestDatabase } from "../test-support/migrated-database";
import { loadOperationsReadModels } from "./operations-read-service";

const EVENT_ID = "synthetic-event";
const PROJECTION_READ_AT = "2026-08-10T12:00:00.000Z";

function createDatabase(input?: {
  missingAssistClaimsTable?: boolean;
  missingGateDisplayFilterColumn?: boolean;
}) {
  const statements: string[] = [];
  const bindings: unknown[][] = [];
  const prepare = vi.fn((sql: string) => {
    statements.push(sql);
    const statementIndex = statements.length - 1;
    return {
      bind: (...values: unknown[]) => {
        bindings[statementIndex] = values;
        return {
          sql,
          all: async () => {
            if (input?.missingAssistClaimsTable && sql.includes("FROM flight_line_assist_claims")) {
              throw new Error("no such table: flight_line_assist_claims");
            }
            return { results: [] };
          },
          first: async () => null,
        };
      },
    };
  });
  const batches: D1PreparedStatement[][] = [];
  const batch = vi.fn(async (preparedStatements: D1PreparedStatement[]) => {
    batches.push(preparedStatements);
    if (
      input?.missingGateDisplayFilterColumn &&
      preparedStatements.some((statement) =>
        (statement as unknown as { sql: string }).sql.includes("g.display_filter_json"),
      )
    ) {
      throw new Error("no such column: g.display_filter_json");
    }
    return Promise.all(
      preparedStatements.map((statement) =>
        (statement as unknown as { all: () => Promise<D1Result<unknown>> }).all(),
      ),
    );
  });
  return {
    database: { prepare, batch } as unknown as D1Database,
    statements,
    bindings,
    batches,
  };
}

describe("operations read service", () => {
  it("keeps grouped read models event-scoped against migrated SQLite", async () => {
    const testDatabase = createD1TestDatabase();
    try {
      applyDemoSeed(testDatabase.database);
      testDatabase.database.exec(`
        INSERT INTO operation_days
          (id, name, event_date, time_zone, status, version, created_at, updated_at)
        VALUES
          ('other-event', 'Other synthetic event', '2026-07-12', 'Europe/Berlin',
           'PREPARATION', 0, '2026-07-12T08:00:00.000Z', '2026-07-12T08:00:00.000Z');
        INSERT INTO gates
          (id, operation_day_id, label, gate_type, active, sort_order, created_at, updated_at)
        VALUES
          ('other-gate', 'other-event', 'Other gate', 'FLIGHT_LINE', 1, 10,
           '2026-07-12T08:00:00.000Z', '2026-07-12T08:00:00.000Z');
        INSERT INTO resource_groups
          (id, operation_day_id, name, short_code, gate_id, created_at, updated_at)
        VALUES
          ('other-resource-group', 'other-event', 'Other group', 'OT', 'other-gate',
           '2026-07-12T08:00:00.000Z', '2026-07-12T08:00:00.000Z');
        INSERT INTO products
          (id, operation_day_id, resource_group_id, gate_id, name, code, price_cents,
           reference_capacity, reference_duration_minutes, promised_flight_minutes,
           created_at, updated_at)
        VALUES
          ('other-product', 'other-event', 'other-resource-group', 'other-gate',
           'Other product', 'OTHER', 1000, 1, 10, 10,
           '2026-07-12T08:00:00.000Z', '2026-07-12T08:00:00.000Z');
      `);

      const result = await loadOperationsReadModels(
        testDatabase.d1,
        "demo-2026",
        PROJECTION_READ_AT,
      );

      expect(result.eventId).toBe("demo-2026");
      expect(result.projectionReadAt).toBe(PROJECTION_READ_AT);
      expect(result.products.results.map((product) => product.id)).toEqual([
        "panorama-20",
        "panorama-30",
      ]);
      expect(result.gatesRows.results.map((gate) => gate.id)).toEqual(["demo-2026-gate-main"]);
      expect(result.resourceGroupRows.results.map((group) => group.id)).toEqual(["rg-panorama"]);
      expect(result.groups.commercial.products).toBe(result.products);
      expect(result.groups.operations.rotations).toBe(result.rotations);
      expect(result.groups.resources.fleetRows).toBe(result.fleetRows);
      expect(result.groups.planning.gatesRows).toBe(result.gatesRows);
      expect(JSON.stringify(result)).not.toContain("other-product");
    } finally {
      testDatabase.close();
    }
  });

  it("loads every projection with stable event scoping and query semantics", async () => {
    const context = createDatabase();
    const result = await loadOperationsReadModels(context.database, EVENT_ID, PROJECTION_READ_AT);

    expect(context.statements).toHaveLength(15);
    expect(context.batches).toHaveLength(1);
    expect(context.batches[0]).toHaveLength(14);
    expect(result.metricsRow).toBeNull();
    expect(result.assistClaims).toEqual([]);
    for (const [index, sql] of context.statements.entries()) {
      expect(sql).toContain("?1");
      expect(context.bindings[index]?.[0]).toBe(EVENT_ID);
    }

    const combinedSql = context.statements.join("\n");
    expect(combinedSql).toContain("segment_group.precalled_at");
    expect(combinedSql).toContain("assigned_resource_group_ids_json");
    expect(combinedSql).toContain("COALESCE(r.gate_id, MIN(p.gate_id), '') AS gate_id");
    expect(combinedSql).toContain("r.operational_note");
    expect(combinedSql).toContain("tickets_json");
    expect(combinedSql).toContain("planned_boarding_at");
    expect(combinedSql).toContain("predicted_boarding_at");
    expect(combinedSql).toContain("'partNumber', grouped_tickets.part_number");
    expect(combinedSql).toContain("'partCount', grouped_tickets.part_count");
    expect(combinedSql).toContain("JOIN booking_group_parts grouped_part");
    expect(combinedSql).toContain("JOIN next_draft_segments next_segment");
    expect(combinedSql).not.toContain("(SELECT queued_segment.ticket_count");
    expect(combinedSql).toContain("next_segment_ticket_count");

    const leaseIndex = context.statements.findIndex((sql) =>
      sql.includes("FROM dispatch_recommendation_leases lease"),
    );
    expect(context.bindings[leaseIndex]).toEqual([EVENT_ID, PROJECTION_READ_AT]);
  });

  it("keeps compatibility with databases created before assist claims", async () => {
    const context = createDatabase({ missingAssistClaimsTable: true });
    const result = await loadOperationsReadModels(context.database, EVENT_ID, PROJECTION_READ_AT);

    expect(result.assistClaims).toEqual([]);
  });

  it("retries the read batch once for the legacy gate display schema", async () => {
    const context = createDatabase({ missingGateDisplayFilterColumn: true });

    await expect(
      loadOperationsReadModels(context.database, EVENT_ID, PROJECTION_READ_AT),
    ).resolves.toBeDefined();

    expect(context.batches).toHaveLength(2);
    const fallbackSql = context.batches[1]?.map(
      (statement) => (statement as unknown as { sql: string }).sql,
    );
    expect(fallbackSql).toContainEqual(
      expect.stringContaining(
        `'${JSON.stringify({
          productIds: [],
          rotationStatuses: [],
        })}' AS display_filter_json`,
      ),
    );
  });
});
