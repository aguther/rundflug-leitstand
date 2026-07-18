import { describe, expect, it } from "vitest";
import migration from "../migrations/0036_v1_5_stable_operations.sql?raw";
import coordinator from "./event-coordinator.ts?raw";
import worker from "./index.ts?raw";

describe("V1.5 stable operations", () => {
  it("stores printable codes and stable booking-group communication data", () => {
    expect(migration).toContain("ALTER TABLE tickets ADD COLUMN public_code TEXT");
    expect(migration).toContain("ALTER TABLE ticket_groups ADD COLUMN communication_number");
    expect(coordinator).toContain("public_code_hash, public_code");
  });

  it("combines only explicitly selected whole groups in one serialized command", () => {
    const handler = coordinator.match(
      /private async handleRotationTransition[\s\S]*?private async handleApplyOutageRecovery/,
    )?.[0];
    expect(handler).toBeTruthy();
    expect(handler).toContain("command.payload.ticketGroupIds");
    expect(handler).toContain("RESOURCE_GROUP_MISMATCH");
    expect(handler).toContain("AIRCRAFT_CAPACITY_EXCEEDED");
    expect(handler).toContain("UPDATE rotation_tickets SET released_at");
    expect(handler).toContain("INSERT INTO rotation_tickets");
    expect(handler).toContain("this.env.DB.batch");
  });

  it("exposes stored codes only through the cashier/admin print route", () => {
    const route = worker.match(
      /app\.get\("\/api\/events\/:eventId\/ticket-groups\/:ticketGroupId\/print-data"[\s\S]*?\n}\);/,
    )?.[0];
    expect(route).toBeTruthy();
    expect(route).toContain('["CASHIER", "ADMIN"]');
    expect(route).toContain("t.public_code");
    expect(route).not.toContain("console.");
  });

  it("allows the protected cashier list to load the latest groups without a search term", () => {
    const route = worker.match(
      /app\.get\("\/api\/events\/:eventId\/tickets\/search"[\s\S]*?\n}\);/,
    )?.[0];
    expect(route).toBeTruthy();
    expect(route).toContain('["CASHIER", "FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]');
    expect(route).toContain("rawQuery.length === 1");
    expect(route).toContain("?6 = ''");
    expect(route).toContain("ORDER BY tg.sold_at DESC LIMIT 20");
  });

  it("publishes explicit off-block, on-block and turnaround events", () => {
    expect(coordinator).toContain('MARK_OFF_BLOCK: "MARK_OFF_BLOCK"');
    expect(coordinator).toContain('MARK_ON_BLOCK: "MARK_ON_BLOCK"');
    expect(coordinator).toContain('COMPLETE_TURNAROUND: "TURNAROUND_COMPLETED"');
  });
});
