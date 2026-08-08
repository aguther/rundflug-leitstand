import { describe, expect, it } from "vitest";
import initialMigration from "../migrations/0001_initial.sql?raw";
import dailyReport from "./daily-report.ts?raw";

describe("append-only operational audit coverage", () => {
  it("keeps historical rebooking events readable after V16-KAS-050 removed new rebooking", () => {
    expect(dailyReport).toContain("TICKET_GROUP_REBOOKED");
  });

  it("prevents updates and deletes at the D1 source of truth", () => {
    expect(initialMigration).toMatch(
      /CREATE TRIGGER operational_events_no_update[\s\S]*BEFORE UPDATE ON operational_events/,
    );
    expect(initialMigration).toMatch(
      /CREATE TRIGGER operational_events_no_delete[\s\S]*BEFORE DELETE ON operational_events/,
    );
  });
});
