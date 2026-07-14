import { describe, expect, it } from "vitest";
import migration from "../migrations/0031_gate_display_filters.sql?raw";
import worker from "./index.ts?raw";

describe("gate display filters", () => {
  it("stores a valid non-personal filter with a show-all default", () => {
    expect(migration).toContain("display_filter_json TEXT NOT NULL");
    expect(migration).toContain('"productIds":[]');
    expect(migration).toContain('"rotationStatuses":[]');
    expect(migration).not.toMatch(/guest|name|phone/i);
  });

  it("projects gate assignments from resource groups instead of duplicating them", () => {
    expect(worker).toContain("assigned_resource_group_ids_json");
    expect(worker).toContain("assignedResourceGroupIds");
  });
});
