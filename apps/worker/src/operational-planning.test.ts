import { commandEnvelopeSchema, operationBoardSchema } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import migration from "../migrations/0046_operational_plans.sql?raw";
import coordinator from "./event-coordinator.ts?raw";
import worker from "./index.ts?raw";

describe("general operational planning", () => {
  it("stores plans separately from confirmed operational blocks", () => {
    expect(migration).toContain("CREATE TABLE planned_operational_constraints");
    expect(migration).toContain("status IN ('PLANNED', 'ACTIVE', 'CLEARED', 'CANCELED')");
    expect(migration).toContain("ALTER TABLE operational_blocks ADD COLUMN planned_operation_id");
    expect(migration).toContain("ALTER TABLE operation_days ADD COLUMN operations_start_at");
  });

  it("accepts approximate windows and rejects inverted durations", () => {
    const command = {
      commandId: "16f1b4fa-1b2d-4aec-8ab0-674fd3088c84",
      eventId: "event-1",
      deviceId: "director-1",
      expectedVersion: 3,
      issuedAt: "2026-07-22T09:00:00.000Z",
      type: "UPSERT_PLANNED_OPERATION",
      payload: {
        planId: "39d792dd-90ed-4477-91dc-fdd4e4d534d7",
        planExpectedVersion: null,
        scopeType: "AIRCRAFT",
        scopeId: "aircraft-1",
        kind: "PAUSE",
        startMode: "TIME_WINDOW",
        earliestStartAt: "2026-07-22T10:00:00.000Z",
        latestStartAt: "2026-07-22T10:15:00.000Z",
        afterRotationId: null,
        minimumDurationMinutes: 10,
        typicalDurationMinutes: 20,
        maximumDurationMinutes: 30,
        reason: "Geplante Pause",
        publicNote: "",
      },
    } as const;
    expect(commandEnvelopeSchema.safeParse(command).success).toBe(true);
    expect(
      commandEnvelopeSchema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          minimumDurationMinutes: 30,
          typicalDurationMinutes: 20,
        },
      }).success,
    ).toBe(false);
    expect(
      commandEnvelopeSchema.safeParse({
        ...command,
        payload: { ...command.payload, publicNote: "Pause bis etwa 11 Uhr" },
      }).success,
    ).toBe(false);
  });

  it("keeps planning idempotent, versioned, audited and non-automatic", () => {
    const handler = coordinator.match(
      /private async handlePlannedOperation[\s\S]*?private async handleFleetAdministration/,
    )?.[0];
    expect(handler).toBeTruthy();
    expect(handler).toContain("PLANNED_OPERATION_VERSION_CONFLICT");
    expect(handler).toContain("PLANNED_OPERATION_ROTATION_SCOPE_MISMATCH");
    expect(handler).toContain("UPDATE operation_days SET version");
    expect(handler).toContain("INSERT INTO operational_events");
    expect(handler).toContain("INSERT INTO idempotency_receipts");
    expect(handler).toContain("INSERT INTO outbox");
    expect(handler).not.toContain("UPDATE aircraft SET operational_state");
    expect(handler).not.toContain("UPDATE resource_groups SET status");
  });

  it("publishes plans on the private operation board but no public cause field", () => {
    expect(worker).toContain("plannedOperations: plannedOperationRows.results.map");
    expect(worker).toContain("plan.status = 'ACTIVE'");
    expect(worker).toContain("AS planned_public_note");
    expect(operationBoardSchema.shape.plannedOperations).toBeTruthy();
    expect(worker).not.toContain("publicOperationalPlanReason");
  });
});
