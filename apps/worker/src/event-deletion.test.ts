import { describe, expect, it } from "vitest";
import deletion from "./event-deletion.ts?raw";
import worker from "./index.ts?raw";

describe("disposable event lifecycle", () => {
  it("deletes dependent operational data before the event root", () => {
    expect(deletion.indexOf("DELETE FROM rotation_tickets")).toBeLessThan(
      deletion.indexOf("DELETE FROM rotations WHERE"),
    );
    expect(deletion.indexOf("DELETE FROM tickets WHERE")).toBeLessThan(
      deletion.indexOf("DELETE FROM ticket_groups WHERE"),
    );
    expect(deletion.indexOf("DELETE FROM fids_preferences")).toBeLessThan(
      deletion.indexOf("DELETE FROM operation_days WHERE"),
    );
    expect(deletion.trim()).toContain('"DELETE FROM operation_days WHERE id = ?1"');
  });

  it("requires admin authorization and an exact event-id confirmation", () => {
    const route = worker.match(
      /app\.delete\("\/api\/admin\/events\/:eventId"[\s\S]*?app\.put\("\/api\/admin\/events\/:eventId\/logo"/,
    )?.[0];
    expect(route).toBeTruthy();
    expect(route).toContain('device?.role !== "ADMIN"');
    expect(route).toContain("input?.confirmation !== eventId");
    expect(route).toContain("eventDeletionStatements");
  });

  it("exports only contextual aggregate performance data", () => {
    expect(worker).toContain("/exports/performance-profile.json");
    expect(worker).toContain("average_turnaround_minutes");
    expect(worker).toContain("passengerSeatCounts");
  });
});
