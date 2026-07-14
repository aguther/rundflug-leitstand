import { operationalHistoryQuerySchema } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import { buildOperationalHistoryStatement } from "./operational-history";

describe("operational history query", () => {
  it("binds every V1 entity filter without interpolating user input", () => {
    const hostileTicketId = "ticket' OR 1=1 --";
    const query = operationalHistoryQuerySchema.parse({
      ticketId: hostileTicketId,
      ticketGroupId: "group-1",
      rotationId: "rotation-1",
      flightGroupId: "flight-group-1",
      aircraftId: "aircraft-1",
      pilotId: "pilot-1",
      productId: "product-1",
      resourceGroupId: "resource-group-1",
      gateId: "gate-1",
      communicationNumber: 123,
      ticketStatus: "COMPLETED",
      rotationStatus: "COMPLETED",
      since: "2026-07-11T08:00:00.000Z",
      until: "2026-07-11T18:00:00.000Z",
      limit: 25,
      offset: 50,
    });

    const statement = buildOperationalHistoryStatement("event-1", query);

    expect(statement.sql).not.toContain(hostileTicketId);
    expect(statement.bindings).toEqual([
      "event-1",
      hostileTicketId,
      "group-1",
      "rotation-1",
      "flight-group-1",
      "aircraft-1",
      "pilot-1",
      "product-1",
      "resource-group-1",
      "gate-1",
      123,
      "COMPLETED",
      "COMPLETED",
      "2026-07-11T08:00:00.000Z",
      "2026-07-11T18:00:00.000Z",
      25,
      50,
    ]);
    expect(statement.sql).toContain("t.id = ?2");
    expect(statement.sql).toContain("r.aircraft_id = ?6");
    expect(statement.sql).toContain("r.pilot_id = ?7");
    expect(statement.sql).toContain("p.id = ?8");
    expect(statement.sql).toContain("rg.id = ?9");
    expect(statement.sql).toContain("fg.communication_number = ?11");
    expect(statement.sql).toContain("t.status = ?12");
    expect(statement.sql).toContain("r.status = ?13");
    expect(statement.sql).toContain("LIMIT ?16 OFFSET ?17");
  });

  it("keeps released assignments and applies safe pagination defaults", () => {
    const statement = buildOperationalHistoryStatement(
      "event-1",
      operationalHistoryQuerySchema.parse({}),
    );

    expect(statement.bindings).toEqual(["event-1", 100, 0]);
    expect(statement.sql).toContain("LEFT JOIN rotation_tickets rt ON rt.ticket_id = t.id");
    expect(statement.sql).not.toContain("rt.released_at IS NULL");
    expect(statement.sql).toContain("COUNT(*) OVER() AS total_count");
    expect(statement.sql).toContain("LIMIT ?2 OFFSET ?3");
  });
});
