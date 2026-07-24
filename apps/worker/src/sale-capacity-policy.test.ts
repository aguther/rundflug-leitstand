import { describe, expect, it } from "vitest";
import cashierSource from "../../web/src/cashier-view.tsx?raw";
import coordinatorSource from "./event-coordinator.ts?raw";
import workerSource from "./index.ts?raw";

describe("V1.9.1 sales capacity policy", () => {
  it("uses active resource-group assignments for sale grouping independent of temporary state", () => {
    const saleCommand = coordinatorSource.slice(
      coordinatorSource.indexOf('command.type === "SELL_TICKET_GROUP"'),
      coordinatorSource.indexOf('command.type === "ASSIGN_AIRCRAFT_PILOT"'),
    );
    expect(saleCommand).toContain("m.active_until IS NULL");
    expect(saleCommand).not.toContain("a.operational_state NOT IN");
    expect(saleCommand).not.toContain("SALE_BLOCKED_CAPACITY");
    expect(saleCommand).toContain("SALE_BLOCKED_NO_AIRCRAFT");
  });

  it("keeps temporary states in forecast capacity while preserving assigned group capacity", () => {
    expect(workerSource).toContain("assignedGroupAircraft");
    expect(workerSource).toContain("operationalGroupAircraft");
    expect(workerSource).toContain(
      '["INACTIVE", "PAUSED", "REFUELING"].includes(aircraft.operational_state)',
    );
    expect(workerSource).toContain("deriveResourceGroupCapacity(allGroupAircraftSeats)");
  });

  it("does not turn the forecast recommendation into a disabled cashier action", () => {
    const disabledRule = cashierSource.slice(
      cashierSource.indexOf("const saleDisabled ="),
      cashierSource.indexOf("return (", cashierSource.indexOf("const saleDisabled =")),
    );
    expect(disabledRule).not.toContain("saleRecommended");
    expect(disabledRule).not.toContain("remainingSellableSeats");
  });
});
