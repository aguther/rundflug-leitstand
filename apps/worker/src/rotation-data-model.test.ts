import { describe, expect, it } from "vitest";
import rotationMigration from "../migrations/0026_rotation_gate_and_note.sql?raw";
import capacityMigration from "../migrations/0027_rotation_capacity_queue.sql?raw";
import coordinator from "./event-coordinator.ts?raw";
import worker from "./index.ts?raw";

describe("D-050 rotation data model", () => {
  it("stores the effective gate and an anonymous organizational note on the rotation", () => {
    expect(rotationMigration).toMatch(
      /ALTER TABLE rotations ADD COLUMN gate_id TEXT REFERENCES gates\(id\)/,
    );
    expect(rotationMigration).toContain(
      "ALTER TABLE rotations ADD COLUMN operational_note TEXT NOT NULL DEFAULT ''",
    );
    expect(rotationMigration).toMatch(/UPDATE rotations[\s\S]*products[\s\S]*resource_groups/);
    expect(coordinator).toMatch(/INSERT INTO rotations[\s\S]*flight_group_id, gate_id, status/);
  });

  it("persists note changes with audit, idempotency and outbox in one batch", () => {
    const handler = coordinator.match(
      /private async handleRotationNote[\s\S]*?private async handleEventLifecycle/,
    )?.[0];
    expect(handler).toBeTruthy();
    expect(handler).toContain("UPDATE rotations SET operational_note");
    expect(handler).toContain("ROTATION_NOTE_SET");
    expect(handler).toContain("INSERT INTO operational_events");
    expect(handler).toContain("INSERT INTO idempotency_receipts");
    expect(handler).toContain("INSERT INTO outbox");
    expect(handler).toContain("this.env.DB.batch");
  });

  it("returns gate, note, tickets and all three timeline kinds on the operation board", () => {
    expect(worker).toContain("r.operational_note");
    expect(worker).toContain("AS gate_id");
    expect(worker).toContain("AS gate_label");
    expect(worker).toContain("tickets_json");
    expect(worker).toContain("planned_boarding_at");
    expect(worker).toContain("predicted_boarding_at");
    expect(worker).toContain("called_at");
  });

  it("separates stable communication identifiers from mutable queue and capacity data", () => {
    expect(capacityMigration).toContain("ALTER TABLE flight_groups ADD COLUMN queue_position");
    expect(capacityMigration).toContain("ALTER TABLE rotations ADD COLUMN usable_capacity");
    expect(worker).toContain("queuePosition: rotation.queue_position");
    expect(worker).toContain("capacityReduced:");
  });

  it("persists capacity changes, whole-group requeueing and audit atomically", () => {
    const handler = coordinator.match(
      /private async handleRotationCapacity[\s\S]*?private async handleManualTicketGroupMove/,
    )?.[0];
    expect(handler).toBeTruthy();
    expect(handler).toContain("planRotationCapacityReduction");
    expect(handler).toContain("ROTATION_CAPACITY_CHANGED");
    expect(handler).toContain("UPDATE rotation_tickets SET released_at");
    expect(handler).toContain("INSERT INTO idempotency_receipts");
    expect(handler).toContain("INSERT INTO outbox");
    expect(handler).toContain("this.env.DB.batch");
  });
});
