import { describe, expect, it } from "vitest";
import rotationMigration from "../migrations/0026_rotation_gate_and_note.sql?raw";
import capacityMigration from "../migrations/0027_rotation_capacity_queue.sql?raw";
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
  });

  it("separates stable communication identifiers from mutable queue and capacity data", () => {
    expect(capacityMigration).toContain("ALTER TABLE flight_groups ADD COLUMN queue_position");
    expect(capacityMigration).toContain("ALTER TABLE rotations ADD COLUMN usable_capacity");
    expect(worker).toContain("queuePosition: rotation.queue_position");
    expect(worker).toContain("capacityReduced:");
  });
});
