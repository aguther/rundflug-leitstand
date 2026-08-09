import { describe, expect, it } from "vitest";
import migration from "../migrations/0036_v1_5_stable_operations.sql?raw";
import worker from "./index.ts?raw";

describe("V1.5 stable operations", () => {
  it("stores printable codes and stable booking-group communication data", () => {
    expect(migration).toContain("ALTER TABLE tickets ADD COLUMN public_code TEXT");
    expect(migration).toContain("ALTER TABLE ticket_groups ADD COLUMN communication_number");
  });

  it("exposes stored codes only through the cashier/admin print route", () => {
    const route = worker.slice(
      worker.indexOf('eventRoutes("/ticket-groups/:ticketGroupId/print-data")'),
      worker.indexOf('eventRoutes("/history")'),
    );
    expect(route).toBeTruthy();
    expect(route).toContain('["CASHIER", "ADMIN"]');
    expect(route).toContain("t.public_code");
    expect(route).not.toContain("console.");
  });

  it("allows the protected cashier list to load the latest groups without a search term", () => {
    const route = worker.slice(
      worker.indexOf('eventRoutes("/tickets/search")'),
      worker.indexOf('eventRoutes("/ticket-groups/:ticketGroupId/print-data")'),
    );
    expect(route).toBeTruthy();
    expect(route).toContain('["CASHIER", "FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]');
    expect(route).toContain("rawQuery.length === 1");
    expect(route).toContain("ticketSearchRequestSchema.safeParse");
    expect(route).toContain("ticketSearchStatusCondition(request.status)");
    expect(route).toContain("ORDER BY tg.sold_at DESC, tg.id DESC");
    expect(route).toContain("nextCursor");
  });
});
