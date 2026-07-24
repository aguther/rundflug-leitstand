import { describe, expect, it } from "vitest";
import domainSource from "../../../packages/domain/src/index.ts?raw";
import coordinatorSource from "./event-coordinator.ts?raw";

describe("SET_OPERATIONAL_NOTE authorization and persistence", () => {
  it("allows only Flight Director and Admin", () => {
    expect(domainSource).toContain('SET_OPERATIONAL_NOTE: ["FLIGHT_DIRECTOR", "ADMIN"]');
    expect(domainSource).not.toContain(
      'SET_OPERATIONAL_NOTE: ["CASHIER", "FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]',
    );
    expect(coordinatorSource).toContain(
      "assertRoleMayExecute(device.role, command.type as OperationalCommandType)",
    );
  });

  it("checks idempotency and version before the audited atomic batch", () => {
    const start = coordinatorSource.indexOf('if (command.type !== "SET_OPERATIONAL_NOTE")');
    const end = coordinatorSource.indexOf("} catch (reason: unknown)", start);
    const handler = coordinatorSource.slice(start, end);
    expect(
      coordinatorSource.indexOf("SELECT response_json FROM idempotency_receipts"),
    ).toBeLessThan(start);
    expect(coordinatorSource.indexOf("validateCommandVersion(command, current)")).toBeLessThan(
      start,
    );
    expect(handler).toContain("OPERATIONAL_NOTE_SET");
    expect(handler).toContain("WHERE id = ?4 AND version = ?5");
    expect(handler).toContain("INSERT INTO operational_events");
    expect(handler).toContain("INSERT INTO idempotency_receipts");
    expect(handler).toContain("INSERT INTO outbox");
    expect(handler).toContain("await this.env.DB.batch");
  });
});
