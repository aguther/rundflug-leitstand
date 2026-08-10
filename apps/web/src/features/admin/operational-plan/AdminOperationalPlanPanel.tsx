import type { OperationBoard } from "@rundflug/contracts";
import { sendCommand } from "../../../api";
import { ADMIN_DEVICE_ID, deviceTokenFor, EVENT_ID } from "../../../operation-workspace";
import type {
  PlannedOperation,
  RecurringOperationalRule,
  UpsertPlannedOperationPayload,
  UpsertRecurringOperationalRulePayload,
} from "../../operations/OperationalPlanPanel";
import { OperationalPlanWorkspace } from "./OperationalPlanWorkspace";

interface AdminOperationalPlanPanelProps {
  board: OperationBoard;
  busy: boolean;
  onMessage: (message: string) => void;
  onRefresh: () => Promise<unknown>;
  onRefreshHistory: () => Promise<unknown>;
  onRunBusyAction: (key: string, action: () => Promise<void>) => Promise<void>;
  readOnly: boolean;
}

export function AdminOperationalPlanPanel({
  board,
  busy,
  onMessage,
  onRefresh,
  onRefreshHistory,
  onRunBusyAction,
  readOnly,
}: AdminOperationalPlanPanelProps) {
  async function persistCommand(
    command:
      | { type: "UPSERT_PLANNED_OPERATION"; payload: UpsertPlannedOperationPayload }
      | {
          type: "CANCEL_PLANNED_OPERATION";
          payload: { planId: string; planExpectedVersion: number };
        }
      | {
          type: "UPSERT_RECURRING_OPERATIONAL_RULE";
          payload: UpsertRecurringOperationalRulePayload;
        }
      | {
          type: "DISABLE_RECURRING_OPERATIONAL_RULE";
          payload: { ruleId: string; ruleExpectedVersion: number; reason: string };
        },
    successMessage: string,
    fallbackError: string,
  ) {
    if (readOnly) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          ...command,
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      onMessage(successMessage);
      await onRefresh();
      await onRefreshHistory();
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : fallbackError);
      throw cause;
    }
  }

  function upsertPlannedOperation(payload: UpsertPlannedOperationPayload) {
    return onRunBusyAction("admin-plan-upsert", () =>
      persistCommand(
        { type: "UPSERT_PLANNED_OPERATION", payload },
        "Planeintrag gespeichert; der operative Zustand bleibt unverändert.",
        "Planeintrag konnte nicht gespeichert werden.",
      ),
    );
  }

  function cancelPlannedOperation(plan: PlannedOperation) {
    return onRunBusyAction("admin-plan-cancel", () =>
      persistCommand(
        {
          type: "CANCEL_PLANNED_OPERATION",
          payload: { planId: plan.id, planExpectedVersion: plan.version },
        },
        "Planeintrag abgesagt; laufende Zustände wurden nicht verändert.",
        "Planeintrag konnte nicht abgesagt werden.",
      ),
    );
  }

  function upsertRecurringRule(payload: UpsertRecurringOperationalRulePayload) {
    return onRunBusyAction("admin-rule-upsert", () =>
      persistCommand(
        { type: "UPSERT_RECURRING_OPERATIONAL_RULE", payload },
        "Wiederkehrende Regel gespeichert.",
        "Regel konnte nicht gespeichert werden.",
      ),
    );
  }

  function disableRecurringRule(rule: RecurringOperationalRule) {
    return onRunBusyAction("admin-rule-disable", () =>
      persistCommand(
        {
          type: "DISABLE_RECURRING_OPERATIONAL_RULE",
          payload: {
            ruleId: rule.id,
            ruleExpectedVersion: rule.version,
            reason: "Wiederkehrende Tagesregel deaktiviert.",
          },
        },
        "Wiederkehrende Regel deaktiviert; offene Planeinträge bleiben bestehen.",
        "Regel konnte nicht deaktiviert werden.",
      ),
    );
  }

  return (
    <section
      aria-labelledby="admin-event-step-operational-plan-tab"
      id="admin-event-step-operational-plan-panel"
      role="tabpanel"
    >
      <OperationalPlanWorkspace
        board={board}
        panelProps={{
          aircraft: board.aircraft,
          busy,
          eventId: board.event.eventId,
          eventTimeZone: board.event.timeZone,
          mode: "admin",
          onCancel: cancelPlannedOperation,
          onDisableRecurringRule: disableRecurringRule,
          onUpsert: upsertPlannedOperation,
          onUpsertRecurringRule: upsertRecurringRule,
          pilots: board.pilots,
          plannedOperations: board.plannedOperations,
          recurringOperationalRules: board.recurringOperationalRules,
          readOnly,
          resourceGroups: board.resourceGroups,
          rotations: board.rotations,
        }}
      />
    </section>
  );
}
