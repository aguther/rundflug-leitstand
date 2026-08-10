import type { CommandPrecondition } from "@rundflug/contracts";
import type { StoredEventRow } from "./types";

export interface CommandAggregateTarget {
  aggregateType: CommandPrecondition["aggregateType"];
  aggregateId: string;
}

export interface PlannedOperationRow {
  scope_type: "EVENT" | "RESOURCE_GROUP" | "AIRCRAFT" | "PILOT";
  scope_id: string;
  status: "PLANNED" | "ACTIVE" | "CLEARED" | "CANCELED";
  effect_mode: "BLOCKING" | "SLOWDOWN";
}

export interface ActiveOperatorClaimRow {
  aircraft_id: string;
  revision: number;
}

export type PlannedOperationExpectation =
  | { kind: "none" }
  | { kind: "unsupported"; plannedOperationId: string }
  | {
      kind: "supported";
      plannedOperationId: string;
      scopeType: PlannedOperationRow["scope_type"];
      scopeId: string;
      activating: boolean;
    };

export interface CommandPreflightReads {
  idempotencyResponseJson: string | null;
  current: StoredEventRow | null;
  aggregateVersion: number | null;
  plannedOperation: PlannedOperationRow | null;
  activeOperatorClaim: ActiveOperatorClaimRow | null;
  targetRotationAircraftId: string | null;
  batchCount: 1;
  statementCount: number;
  durationMs: number;
}
