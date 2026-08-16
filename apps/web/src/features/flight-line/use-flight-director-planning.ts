import type { CommandEnvelope, OperationBoard } from "@rundflug/contracts";
import type { Dispatch, SetStateAction } from "react";
import { sendCommand } from "../../api";
import { plannedAircraftState, plannedResourceGroupStatus } from "./FlightLineViewPresentation";

type PlannedOperation = OperationBoard["plannedOperations"][number];
type RecurringRule = OperationBoard["recurringOperationalRules"][number];
type UpsertPlan = Extract<CommandEnvelope, { type: "UPSERT_PLANNED_OPERATION" }>["payload"];
type UpsertRule = Extract<
  CommandEnvelope,
  { type: "UPSERT_RECURRING_OPERATIONAL_RULE" }
>["payload"];
const AUDIT_REASON = "Operative Entscheidung Flight Director";

interface PlanningOptions {
  board: OperationBoard | null | undefined;
  deviceId: string;
  deviceToken: string;
  eventId: string;
  refresh: () => Promise<unknown>;
  setEventInterruption: (
    interrupted: boolean,
    plannedOperationId?: string,
    expectedReviewAt?: string | null,
  ) => Promise<void>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setOperationsBusy: Dispatch<SetStateAction<boolean>>;
  setResourceGroupStatus: (
    resourceGroupId: string,
    status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED",
    plannedOperationId?: string,
    expectedReviewAt?: string | null,
  ) => Promise<void>;
}

export function useFlightDirectorPlanning(options: PlanningOptions) {
  const {
    board,
    deviceId,
    deviceToken,
    eventId,
    refresh,
    setEventInterruption,
    setMessage,
    setOperationsBusy,
    setResourceGroupStatus,
  } = options;
  const baseCommand = () => ({
    commandId: crypto.randomUUID(),
    eventId,
    deviceId,
    expectedVersion: board?.event.version ?? 0,
    issuedAt: new Date().toISOString(),
  });

  async function execute(command: CommandEnvelope, success: string, failure: string) {
    setOperationsBusy(true);
    try {
      await sendCommand(command, deviceToken);
      setMessage(success);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : failure);
      throw reason;
    } finally {
      setOperationsBusy(false);
    }
  }

  async function upsertPlannedOperation(payload: UpsertPlan) {
    if (!board) return;
    await execute(
      { ...baseCommand(), type: "UPSERT_PLANNED_OPERATION", payload },
      "Planeintrag gespeichert; der operative Zustand bleibt unverändert.",
      "Planeintrag konnte nicht gespeichert werden.",
    );
  }

  async function cancelPlannedOperation(plan: PlannedOperation) {
    if (!board) return;
    await execute(
      {
        ...baseCommand(),
        type: "CANCEL_PLANNED_OPERATION",
        payload: { planId: plan.id, planExpectedVersion: plan.version },
      },
      "Planeintrag abgesagt; laufende Zustände wurden nicht verändert.",
      "Planeintrag konnte nicht abgesagt werden.",
    );
  }

  async function upsertRecurringRule(payload: UpsertRule) {
    if (!board) return;
    await execute(
      { ...baseCommand(), type: "UPSERT_RECURRING_OPERATIONAL_RULE", payload },
      "Wiederkehrende Regel gespeichert.",
      "Regel konnte nicht gespeichert werden.",
    );
  }

  async function disableRecurringRule(rule: RecurringRule) {
    if (!board) return;
    await execute(
      {
        ...baseCommand(),
        type: "DISABLE_RECURRING_OPERATIONAL_RULE",
        payload: {
          ruleId: rule.id,
          ruleExpectedVersion: rule.version,
          reason: "Wiederkehrende Tagesregel deaktiviert.",
        },
      },
      "Wiederkehrende Regel deaktiviert; offene Planeinträge bleiben bestehen.",
      "Regel konnte nicht deaktiviert werden.",
    );
  }

  async function confirmPlannedSlowdown(plan: PlannedOperation, activate: boolean) {
    if (!board) return;
    await execute(
      {
        ...baseCommand(),
        type: "SET_PLANNED_SLOWDOWN_ACTIVE",
        payload: { planId: plan.id, planExpectedVersion: plan.version, active: activate },
      },
      activate
        ? `Verzögerter Betrieb mit ${plan.durationMultiplierPercent ?? 150} % gestartet.`
        : "Verzögerter Betrieb beendet.",
      "Planbestätigung fehlgeschlagen.",
    );
  }

  function plannedScopedCommand(
    plan: PlannedOperation,
    activate: boolean,
    expectedReviewAt: string | null,
  ): CommandEnvelope {
    const base = baseCommand();
    if (plan.scopeType === "AIRCRAFT") {
      return {
        ...base,
        type: "SET_AIRCRAFT_OPERATIONAL_STATE",
        payload: {
          aircraftId: plan.scopeId,
          state: plannedAircraftState(plan, activate),
          reason: AUDIT_REASON,
          expectedReviewAt,
          plannedOperationId: plan.id,
        },
      };
    }
    return {
      ...base,
      type: "SET_PILOT_PAUSE",
      payload: {
        pilotId: plan.scopeId,
        paused: activate,
        reason: AUDIT_REASON,
        expectedReviewAt,
        plannedOperationId: plan.id,
      },
    };
  }

  async function confirmPlannedOperation(plan: PlannedOperation, activate: boolean) {
    if (!board) return;
    if (plan.effectMode === "SLOWDOWN") return confirmPlannedSlowdown(plan, activate);
    const expectedReviewAt = activate
      ? new Date(Date.now() + plan.typicalDurationMinutes * 60_000).toISOString()
      : null;
    if (plan.scopeType === "EVENT")
      return setEventInterruption(activate, plan.id, expectedReviewAt);
    if (plan.scopeType === "RESOURCE_GROUP") {
      return setResourceGroupStatus(
        plan.scopeId,
        plannedResourceGroupStatus(plan, activate),
        plan.id,
        expectedReviewAt,
      );
    }
    await execute(
      plannedScopedCommand(plan, activate, expectedReviewAt),
      activate
        ? "Geplante Einschränkung als gestartet bestätigt."
        : "Geplante Einschränkung als beendet bestätigt.",
      "Planbestätigung fehlgeschlagen.",
    );
  }

  return {
    cancelPlannedOperation,
    confirmPlannedOperation,
    disableRecurringRule,
    upsertPlannedOperation,
    upsertRecurringRule,
  };
}
