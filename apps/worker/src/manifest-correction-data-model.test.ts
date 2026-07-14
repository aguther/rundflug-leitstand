import { describe, expect, it } from "vitest";
import migration from "../migrations/0030_rotation_manifest_corrections.sql?raw";
import coordinator from "./event-coordinator.ts?raw";

describe("post-departure manifest corrections", () => {
  it("stores corrections append-only and without personal fields", () => {
    expect(migration).toMatch(/CREATE TABLE rotation_manifest_corrections/);
    expect(migration).toMatch(/source_rotation_ids_json TEXT NOT NULL/);
    expect(migration).toMatch(/rotation_manifest_corrections_no_update/);
    expect(migration).toMatch(/rotation_manifest_corrections_no_delete/);
    expect(migration).not.toMatch(/guest|passenger_name|phone/i);
  });

  it("keeps the whole group and records that the correction has no safety approval", () => {
    expect(coordinator).toContain('type: "CORRECT_ROTATION_MANIFEST"');
    expect(coordinator).toContain("wholeGroupPreserved: true");
    expect(coordinator).toContain("administrativeCorrection: true");
    expect(coordinator).toContain("safetyApproval: false");
  });
});
