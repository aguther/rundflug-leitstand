import { describe, expect, it } from "vitest";
import { ticketSearchStatusCondition } from "./ticket-search";

describe("ticket search status conditions", () => {
  it("keeps the sold-ticket list inclusive of completed groups", () => {
    expect(ticketSearchStatusCondition("ACTIVE")).toBe("tg.status <> 'CANCELED'");
  });

  it("filters open tickets before pagination", () => {
    expect(ticketSearchStatusCondition("OPEN")).toBe("tg.status NOT IN ('CANCELED', 'COMPLETED')");
  });

  it("isolates canceled tickets", () => {
    expect(ticketSearchStatusCondition("CANCELED")).toBe("tg.status = 'CANCELED'");
  });
});
