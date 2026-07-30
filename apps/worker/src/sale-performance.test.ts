import { describe, expect, it } from "vitest";
import coordinatorSource from "./event-coordinator.ts?raw";

const saleCommand = coordinatorSource.slice(
  coordinatorSource.indexOf('if (command.type === "SELL_TICKET_GROUP")'),
  coordinatorSource.indexOf('if (command.type !== "SET_OPERATIONAL_NOTE")'),
);

describe("ticket sale performance path", () => {
  it("loads product and active assignment capacity together", () => {
    expect(saleCommand).toContain("AS effective_group_capacity");
    expect(saleCommand).toContain("m.active_until IS NULL");
    expect(saleCommand).not.toContain("const aircraftRows");
  });

  it("hashes all public codes concurrently and reads collision plus numbering state once", () => {
    expect(saleCommand).toContain("[groupCodeHash, ...hashes] = await Promise.all");
    expect(saleCommand).toContain("const saleState = await this.env.DB.prepare");
    expect(saleCommand).toContain("AS public_code_exists");
    expect(saleCommand).toContain("AS next_queue_sequence");
    expect(saleCommand).toContain("AS next_flight_number");
    expect(saleCommand).toContain("AS next_ticket_number");
    expect(saleCommand).not.toContain("const existingPublicCode");
    expect(saleCommand).not.toContain("const queueRow");
    expect(saleCommand).not.toContain("const communicationRow");
  });

  it("waits for atomic persistence and exposes privacy-neutral timing phases", () => {
    expect(saleCommand).toContain("await this.env.DB.batch(statements)");
    expect(saleCommand.indexOf("await this.env.DB.batch(statements)")).toBeLessThan(
      saleCommand.indexOf("this.broadcast(result)"),
    );
    expect(saleCommand).toContain("sale-preflight;dur=");
    expect(saleCommand).toContain("sale-persist;dur=");
    expect(saleCommand.slice(saleCommand.indexOf("server-timing"))).not.toContain(
      "normalizedGroupCode",
    );
  });
});
