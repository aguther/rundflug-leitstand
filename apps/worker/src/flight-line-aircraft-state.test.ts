import { describe, expect, it } from "vitest";
import domain from "../../../packages/domain/src/index.ts?raw";
import coordinator from "./event-coordinator.ts?raw";

describe("V1.7.0 Flight-Line-Flugzeugzustände", () => {
  it("authorizes Flight Line for state changes while pilot assignment remains restricted", () => {
    expect(domain).toContain(
      'SET_AIRCRAFT_OPERATIONAL_STATE: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]',
    );
    expect(domain).toContain('ASSIGN_AIRCRAFT_PILOT: ["FLIGHT_DIRECTOR", "ADMIN"]');
  });

  it("keeps expected-version and idempotency checks ahead of state mutation", () => {
    const duplicateCheck = coordinator.indexOf(
      "SELECT response_json FROM idempotency_receipts WHERE command_id = ?1",
    );
    const staleCheck = coordinator.indexOf("current.version !== command.expectedVersion");
    const handler = coordinator.indexOf("private async handleFleetAdministration");
    expect(duplicateCheck).toBeGreaterThan(0);
    expect(staleCheck).toBeGreaterThan(duplicateCheck);
    expect(handler).toBeGreaterThan(staleCheck);
    expect(coordinator).toContain('code: "STALE_VERSION"');
    expect(coordinator).toContain("duplicate: true");
  });

  it("persists one audit event, receipt and outbox entry in the serialized batch", () => {
    const start = coordinator.indexOf("private async handleFleetAdministration");
    const end = coordinator.indexOf("private async handleAircraftPilotAssignment", start);
    const handler = coordinator.slice(start, end);
    expect(handler).toContain("transitionAircraft(");
    expect(handler).toContain('eventType = "AIRCRAFT_OPERATIONAL_STATE_CHANGED"');
    expect(handler.match(/INSERT INTO operational_events/g)).toHaveLength(1);
    expect(handler.match(/INSERT INTO idempotency_receipts/g)).toHaveLength(1);
    expect(handler.match(/INSERT INTO outbox/g)).toHaveLength(1);
    expect(handler).toContain("await this.env.DB.batch(statements)");
  });
});
