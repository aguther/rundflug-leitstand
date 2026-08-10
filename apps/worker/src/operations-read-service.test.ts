import { describe, expect, it, vi } from "vitest";
import { loadOperationsReadModels } from "./operations-read-service";

const EVENT_ID = "synthetic-event";
const PROJECTION_READ_AT = "2026-08-10T12:00:00.000Z";

function createDatabase(input?: { missingAssistClaimsTable?: boolean }) {
  const statements: string[] = [];
  const bindings: unknown[][] = [];
  const prepare = vi.fn((sql: string) => {
    statements.push(sql);
    const statementIndex = statements.length - 1;
    return {
      bind: (...values: unknown[]) => {
        bindings[statementIndex] = values;
        return {
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
  return {
    database: { prepare } as unknown as D1Database,
    statements,
    bindings,
  };
}

describe("operations read service", () => {
  it("loads every projection with stable event scoping and query semantics", async () => {
    const context = createDatabase();
    const result = await loadOperationsReadModels(context.database, EVENT_ID, PROJECTION_READ_AT);

    expect(context.statements).toHaveLength(15);
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
});
