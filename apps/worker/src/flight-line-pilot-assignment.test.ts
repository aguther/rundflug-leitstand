import { describe, expect, it } from "vitest";
import migration from "../migrations/0038_aircraft_state_changed_at.sql?raw";
import coordinator from "./event-coordinator.ts?raw";
import worker from "./index.ts?raw";

describe("V1.6.1 aircraft pilot assignment", () => {
  it("persists and projects the last real aircraft-state transition", () => {
    expect(migration).toContain("ADD COLUMN operational_state_changed_at TEXT");
    expect(migration).toContain("MAX(oe.occurred_at)");
    expect(migration).toContain("updated_at");
    expect(worker).toContain("operationalStateChangedAt: aircraft.operational_state_changed_at");
    expect(coordinator).toContain("WHEN operational_state <> ?1 THEN ?2");
    expect(coordinator).toContain(
      '"UPDATE aircraft SET refuel_reminder_threshold = ?1, updated_at = ?2 WHERE id = ?3"',
    );
  });

  it("uses a separate serialized pilot command with audit, receipt and outbox", () => {
    const start = coordinator.indexOf("private async handleAircraftPilotAssignment");
    const end = coordinator.indexOf("private async handleProductSalesConfiguration", start);
    const handler = coordinator.slice(start, end);
    expect(handler).toContain("AIRCRAFT_PILOT_CHANGED");
    expect(handler).toContain("PILOT_REASSIGN_CONFIRMATION_REQUIRED");
    expect(handler).toContain("PILOT_ASSIGNED_ACTIVE_ROTATION");
    expect(handler).toContain("AIRCRAFT_PILOT_CHANGE_BLOCKED");
    expect(handler).toContain("idempotency_receipts");
    expect(handler).toContain("outbox");
    expect(handler.match(/INSERT INTO operational_events/g)).toHaveLength(1);
  });

  it("requires CALL_NEXT to use the pilot already assigned to the aircraft", () => {
    expect(coordinator).toContain("AIRCRAFT_PILOT_ASSIGNMENT_MISMATCH");
    const transitionStart = coordinator.indexOf("private async handleRotationTransition");
    const transitionEnd = coordinator.indexOf(
      "private async handleApplyOutageRecovery",
      transitionStart,
    );
    const transition = coordinator.slice(transitionStart, transitionEnd);
    expect(transition).not.toContain("UPDATE resource_group_memberships SET current_pilot_id");
  });
});
