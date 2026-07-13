import { describe, expect, it } from "vitest";
import initialMigration from "../migrations/0001_initial.sql?raw";
import coordinator from "./event-coordinator.ts?raw";

const requiredAuditEvents = [
  "TICKET_GROUP_SOLD",
  "TICKET_GROUP_CANCELED",
  "TICKET_GROUP_REBOOKED",
  "FLIGHT_GROUP_CALLED",
  "TICKET_CHECKED_IN",
  "ROTATION_STARTED",
  "ROTATION_LANDED",
  "ROTATION_COMPLETED",
  "ROTATION_NOTE_SET",
  "ROTATION_CAPACITY_CHANGED",
  "TICKET_GROUP_DEFERRED",
  "TICKET_GROUP_NO_SHOW",
  "TICKET_GROUP_MOVED",
  "PILOT_CONFIGURATION_CHANGED",
  "AIRCRAFT_RESOURCE_GROUP_ASSIGNED",
  "AIRCRAFT_REFUEL_PLANNED",
  "EVENT_OPERATION_INTERRUPTED",
  "RESOURCE_GROUP_STATUS_CHANGED",
  "EMERGENCY_MODE_TRIGGERED",
  "ROTATION_ABORTED_TO_QUEUE",
] as const;

describe("append-only operational audit coverage", () => {
  it("keeps every F-HIS-020 minimum event in the command coordinator", () => {
    for (const eventType of requiredAuditEvents) expect(coordinator).toContain(eventType);
    expect(coordinator).toContain("pilotChanged");
  });

  it("prevents updates and deletes at the D1 source of truth", () => {
    expect(initialMigration).toMatch(
      /CREATE TRIGGER operational_events_no_update[\s\S]*BEFORE UPDATE ON operational_events/,
    );
    expect(initialMigration).toMatch(
      /CREATE TRIGGER operational_events_no_delete[\s\S]*BEFORE DELETE ON operational_events/,
    );
    expect(coordinator).not.toMatch(/UPDATE\s+operational_events/i);
    expect(coordinator).not.toMatch(/DELETE\s+FROM\s+operational_events/i);
  });
});
