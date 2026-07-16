import { describe, expect, it } from "vitest";
import migration from "../migrations/0034_automatic_precall.sql?raw";
import coordinatorSource from "./event-coordinator.ts?raw";

describe("persistierter automatischer Voraufruf (F-BEN-030)", () => {
  it("stores a distinct precall without binding an aircraft or changing the rotation", () => {
    expect(migration).toContain("ALTER TABLE flight_groups ADD COLUMN precalled_at TEXT");
    expect(coordinatorSource).toContain("decideAutomaticPrecall");
    expect(coordinatorSource).toContain("FLIGHT_GROUP_PRECALLED");
    expect(coordinatorSource).toContain('trigger: "AUTOMATIC_PRECALL"');
    const persistence = coordinatorSource.slice(
      coordinatorSource.indexOf("private async persistAutomaticPrecalls"),
      coordinatorSource.indexOf("private async handleFleetAdministration"),
    );
    expect(persistence).toContain("UPDATE flight_groups");
    expect(persistence).not.toMatch(/UPDATE rotations|aircraft_id\s*=/i);
  });

  it("keeps the system command optimistic, idempotent and auditable", () => {
    expect(coordinatorSource).toContain("version = ?3");
    expect(coordinatorSource).toContain("version = ?6 AND precalled_at IS NULL");
    expect(coordinatorSource).toContain("precall_trigger = ?1");
    expect(coordinatorSource).toContain("'SYSTEM', 'FLIGHT_GROUP'");
  });
});
