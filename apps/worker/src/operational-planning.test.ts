import { commandEnvelopeSchema, operationBoardSchema } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import migration from "../migrations/0046_operational_plans.sql?raw";
import slowdownMigration from "../migrations/0049_operational_plan_slowdown.sql?raw";
import recurringMigration from "../migrations/0050_recurring_operational_rules.sql?raw";
import coordinator from "./event-coordinator.ts?raw";
import worker from "./index.ts?raw";

describe("general operational planning", () => {
  it("stores plans separately from confirmed operational blocks", () => {
    expect(migration).toContain("CREATE TABLE planned_operational_constraints");
    expect(migration).toContain("status IN ('PLANNED', 'ACTIVE', 'CLEARED', 'CANCELED')");
    expect(migration).toContain("ALTER TABLE operational_blocks ADD COLUMN planned_operation_id");
    expect(migration).toContain("ALTER TABLE operation_days ADD COLUMN operations_start_at");
    expect(slowdownMigration).toContain("ADD COLUMN effect_mode");
    expect(slowdownMigration).toContain("duration_multiplier_percent BETWEEN 110 AND 300");
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
        effectMode: "BLOCKING",
        durationMultiplierPercent: null,
        startMode: "TIME_WINDOW",
        earliestStartAt: "2026-07-22T10:00:00.000Z",
        latestStartAt: "2026-07-22T10:15:00.000Z",
        afterRotationId: null,
        minimumDurationMinutes: 10,
        typicalDurationMinutes: 20,
        maximumDurationMinutes: 30,
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
    expect(
      commandEnvelopeSchema.safeParse({
        ...command,
        payload: { ...command.payload, reason: "Vom Browser vorgegebener Grund" },
      }).success,
    ).toBe(false);
    const cancellation = {
      ...command,
      commandId: "810712d2-692d-47f3-9081-77211cfcfbc9",
      type: "CANCEL_PLANNED_OPERATION",
      payload: {
        planId: command.payload.planId,
        planExpectedVersion: 0,
      },
    } as const;
    expect(commandEnvelopeSchema.safeParse(cancellation).success).toBe(true);
    expect(
      commandEnvelopeSchema.safeParse({
        ...cancellation,
        payload: { ...cancellation.payload, reason: "Vom Browser vorgegebener Absagegrund" },
      }).success,
    ).toBe(false);
    expect(
      commandEnvelopeSchema.safeParse({
        ...command,
        type: "SET_PLANNED_SLOWDOWN_ACTIVE",
        payload: {
          planId: command.payload.planId,
          planExpectedVersion: 0,
          active: true,
        },
      }).success,
    ).toBe(true);
    expect(
      commandEnvelopeSchema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          effectMode: "SLOWDOWN",
          durationMultiplierPercent: 150,
        },
      }).success,
    ).toBe(true);
  });

  it("publishes plans on the private operation board but no public cause field", () => {
    expect(worker).toContain("plannedOperations: plannedOperationRows.results.map");
    expect(worker).toContain("recurringOperationalRules: recurringRuleRows.results.map");
    expect(worker).toContain("plan.status = 'ACTIVE'");
    expect(worker).toContain("AS planned_public_note");
    expect(operationBoardSchema.shape.plannedOperations).toBeTruthy();
    expect(worker).not.toContain("reason: plan.reason");
    expect(worker).not.toContain("publicOperationalPlanReason");
  });

  it("keeps recurring rules versioned, unique, audited and non-automatic", () => {
    expect(recurringMigration).toContain("CREATE TABLE recurring_operational_rules");
    expect(recurringMigration).toContain("idx_recurring_operational_rules_active_target_kind");
    expect(recurringMigration).toContain("recurring_rule_id");
    expect(recurringMigration).toContain("recurrence_sequence");

    const command = {
      commandId: "550e8400-e29b-41d4-a716-446655440401",
      eventId: "event-1",
      deviceId: "director-1",
      expectedVersion: 3,
      issuedAt: "2026-07-22T09:00:00.000Z",
      type: "UPSERT_RECURRING_OPERATIONAL_RULE",
      payload: {
        ruleId: "550e8400-e29b-41d4-a716-446655440402",
        ruleExpectedVersion: null,
        rule: {
          scopeType: "AIRCRAFT",
          scopeId: "aircraft-1",
          kind: "REFUELING",
          triggerMetric: "COMPLETED_ROTATIONS",
          intervalValue: 5,
          minimumDurationMinutes: 8,
          typicalDurationMinutes: 12,
          maximumDurationMinutes: 18,
        },
        reason: "Tankregel für diesen Flugtag",
      },
    } as const;
    expect(commandEnvelopeSchema.safeParse(command).success).toBe(true);
    expect(
      commandEnvelopeSchema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          rule: { ...command.payload.rule, scopeType: "PILOT" },
        },
      }).success,
    ).toBe(false);

    const handler = coordinator.match(
      /private async handleRecurringOperationalRule[\s\S]*?private async handleFleetAdministration/,
    )?.[0];
    expect(handler).toBeTruthy();
    expect(handler).toContain("RECURRING_RULE_VERSION_CONFLICT");
    expect(handler).toContain("RECURRING_RULE_ALREADY_ACTIVE");
    expect(handler).toContain("INSERT INTO operational_events");
    expect(handler).toContain("INSERT INTO idempotency_receipts");
    expect(handler).toContain("INSERT INTO outbox");
    expect(handler).not.toContain("UPDATE aircraft SET operational_state");
    expect(operationBoardSchema.shape.recurringOperationalRules).toBeTruthy();
  });
});
