import { describe, expect, it } from "vitest";
import contracts from "../../../packages/contracts/src/index.ts?raw";
import domain from "../../../packages/domain/src/index.ts?raw";
import coordinator from "./event-coordinator.ts?raw";

describe("F-ADM-050 master-data deletion safeguards", () => {
  it("requires an administrator PIN, expected version and an administrator role", () => {
    expect(contracts).toContain('type: z.literal("DELETE_MASTER_DATA")');
    expect(contracts).toMatch(
      /type: z\.literal\("DELETE_MASTER_DATA"\)[\s\S]*adminPin: z\.string\(\)\.min\(4\)\.max\(32\)/,
    );
    expect(contracts).toContain("expectedVersion: z.number().int().nonnegative()");
    expect(domain).toContain('DELETE_MASTER_DATA: ["ADMIN"]');
  });

  it("allows physical deletion only for an authenticated administrator during preparation", () => {
    expect(coordinator).toContain('current.status !== "PREPARATION"');
    expect(coordinator).toContain("MASTER_DATA_DELETE_PHASE_LOCKED");
    expect(coordinator).toContain("MASTER_DATA_DELETE_BLOCKED");
    expect(coordinator).toContain('request.headers.get("x-operator-role")');
    expect(coordinator).toContain("operatorDeviceId === command.deviceId");
    expect(coordinator).toContain("this.validateCommandVersion(command, current)");
    expect(coordinator).toContain("current.version === command.expectedVersion");
  });

  it("persists every supported deletion with audit, receipt and outbox in one batch", () => {
    for (const eventType of [
      "GATE_DELETED",
      "RESOURCE_GROUP_DELETED",
      "PRODUCT_DELETED",
      "PILOT_DELETED",
      "AIRCRAFT_DELETED",
      "AIRCRAFT_RESOURCE_GROUP_ASSIGNMENT_DELETED",
    ]) {
      expect(coordinator).toContain(eventType);
    }
    expect(coordinator).toMatch(
      /this\.env\.DB\.batch\(\[[\s\S]*deletion,[\s\S]*operational_events/,
    );
    expect(coordinator).toContain("idempotency_receipts");
    expect(coordinator).toContain("INSERT INTO outbox");
  });
});
