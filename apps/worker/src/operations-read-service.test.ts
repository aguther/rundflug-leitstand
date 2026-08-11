import { describe, expect, it, vi } from "vitest";
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
