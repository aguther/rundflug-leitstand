import { describe, expect, it } from "vitest";
import migration from "../migrations/0036_v1_5_stable_operations.sql?raw";

describe("V1.5 stable operations", () => {
  it("stores printable codes and stable booking-group communication data", () => {
    expect(migration).toContain("ALTER TABLE tickets ADD COLUMN public_code TEXT");
    expect(migration).toContain("ALTER TABLE ticket_groups ADD COLUMN communication_number");
  });
});
