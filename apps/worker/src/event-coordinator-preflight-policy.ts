import type { CommandEnvelope } from "@rundflug/contracts";
import { plannedOperationExpectation, scopedCommandTarget } from "./command-preflight";
import type { PlannedOperationRow } from "./command-preflight-types";
import type { StoredEventRow } from "./types";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function conflict(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE },
  });
}

export function validateCommandVersion(
  command: CommandEnvelope,
  current: StoredEventRow,
  aggregateVersion: number | null,
): Response | null {
  if (command.type === "REORDER_CASHIER_PRODUCTS") {
    const observedEventVersion = command.observedEventVersion ?? command.expectedVersion;
    if (observedEventVersion <= current.version) return null;
    return conflict(
      {
        error: {
          code: "FUTURE_VERSION",
          message: "Der beobachtete Veranstaltungsstand liegt vor dem Serverstand.",
          currentVersion: current.version,
        },
      },
      409,
    );
  }

  const target = scopedCommandTarget(command);
  const preconditions = command.preconditions;
  if (!preconditions) {
    if (current.version === command.expectedVersion) return null;
    return conflict(
      {
        error: {
          code: "STALE_VERSION",
          message: "Der Zustand wurde zwischenzeitlich geändert.",
          currentVersion: current.version,
        },
      },
      409,
    );
  }
  if (
    !target ||
    preconditions.length !== 1 ||
    preconditions[0]?.aggregateType !== target.aggregateType ||
    preconditions[0].aggregateId !== target.aggregateId
  ) {
    return conflict(
      {
        error: {
          code: "INVALID_PRECONDITION",
          message: "Die Aggregatversion passt nicht zum Kommandoziel.",
        },
      },
      400,
    );
  }

  const observedEventVersion = command.observedEventVersion ?? command.expectedVersion;
  if (observedEventVersion > current.version) {
    return conflict(
      {
        error: {
          code: "FUTURE_VERSION",
          message: "Der beobachtete Veranstaltungsstand liegt vor dem Serverstand.",
          currentVersion: current.version,
        },
      },
      409,
    );
  }

  const precondition = preconditions[0];
  if (aggregateVersion === null) {
    return conflict(
      {
        error: {
          code: "AGGREGATE_NOT_FOUND",
          message: "Das Kommandoziel wurde nicht gefunden.",
        },
      },
      404,
    );
  }
  if (aggregateVersion === precondition.expectedVersion) return null;
  return conflict(
    {
      error: {
        code: "STALE_AGGREGATE_VERSION",
        message: "Dieses Flugzeug oder dieser Umlauf wurde zwischenzeitlich geändert.",
        currentVersion: current.version,
        conflict: {
          aggregateType: precondition.aggregateType,
          aggregateId: precondition.aggregateId,
          currentAggregateVersion: aggregateVersion,
        },
      },
    },
    409,
  );
}

export function validatePlannedOperationLink(
  command: CommandEnvelope,
  plan: PlannedOperationRow | null,
): Response | null {
  const expectation = plannedOperationExpectation(command);
  if (expectation.kind === "none") return null;
  if (expectation.kind === "unsupported") {
    return conflict(
      {
        error: {
          code: "PLANNED_OPERATION_LINK_NOT_SUPPORTED",
          message: "Dieses Kommando kann nicht mit einem Planeintrag verknüpft werden.",
        },
      },
      409,
    );
  }
  if (!plan) {
    return conflict(
      { error: { code: "PLANNED_OPERATION_NOT_FOUND", message: "Planeintrag nicht gefunden." } },
      404,
    );
  }
  if (plan.effect_mode !== "BLOCKING") {
    return conflict(
      {
        error: {
          code: "PLANNED_OPERATION_EFFECT_MISMATCH",
          message: "Ein verzögerter Betrieb darf keinen Ressourcenstopp auslösen.",
        },
      },
      409,
    );
  }
  if (plan.scope_type !== expectation.scopeType || plan.scope_id !== expectation.scopeId) {
    return conflict(
      {
        error: {
          code: "PLANNED_OPERATION_SCOPE_MISMATCH",
          message: "Planeintrag und operatives Ziel stimmen nicht überein.",
        },
      },
      409,
    );
  }
  if (
    (expectation.activating && plan.status !== "PLANNED") ||
    (!expectation.activating && plan.status !== "ACTIVE")
  ) {
    return conflict(
      {
        error: {
          code: "PLANNED_OPERATION_STATUS_MISMATCH",
          message: "Der Planeintrag ist für diese Bestätigung nicht im passenden Zustand.",
        },
      },
      409,
    );
  }
  return null;
}
