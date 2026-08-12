import type { DeviceRole } from "./authorization-types";
import { DomainRuleError } from "./domain-rule-error";
import { type RotationState, transitionRotation } from "./rotation-state";

export type OutageRecoveryEntryType =
  | "PAPER_SALE"
  | "ROTATION_CALLED"
  | "ROTATION_IN_FLIGHT"
  | "ROTATION_LANDED"
  | "ROTATION_COMPLETED";

export interface OutageRecoveryEntry {
  id: string;
  type: OutageRecoveryEntryType;
  originalOccurredAt: string;
  paperSequence: number;
  paperReference: string;
  ticketKeys?: readonly string[];
}

export interface OutageRecoveryConflict {
  entryId: string;
  code:
    | "DUPLICATE_ENTRY_ID"
    | "DUPLICATE_PAPER_SEQUENCE"
    | "EVENT_IN_FUTURE"
    | "PAPER_REFERENCE_ALREADY_EXISTS"
    | "PAPER_REFERENCE_UNKNOWN"
    | "RECOVERY_TRANSITION_INVALID"
    | "DUPLICATE_TICKET_CODE"
    | "TICKET_CODE_ALREADY_EXISTS";
  message: string;
}

export interface OutageRecoverySimulation {
  orderedEntries: OutageRecoveryEntry[];
  conflicts: OutageRecoveryConflict[];
  canCommit: boolean;
}

export function assertMayStageOutageRecoveryEntry(
  role: DeviceRole,
  entryType: OutageRecoveryEntryType,
): void {
  const permitted =
    role === "ADMIN" ||
    (entryType === "PAPER_SALE" && role === "CASHIER") ||
    (entryType !== "PAPER_SALE" && role === "FLIGHT_DIRECTOR");
  if (!permitted) {
    throw new DomainRuleError(
      "OUTAGE_RECOVERY_ROLE_NOT_AUTHORIZED",
      entryType === "PAPER_SALE"
        ? "Papierverkäufe dürfen nur Kasse oder Administration nacherfassen."
        : "Umlaufereignisse dürfen nur Leiter Flight Line oder Administration nacherfassen.",
    );
  }
}

export function assertOutageRecoveryApproval(input: {
  status: "STAGED" | "CONFLICTED" | "APPROVED" | "APPLYING" | "APPLIED" | "REJECTED";
  createdByDeviceId: string;
  approvedByDeviceId: string;
  simulatedAgainstVersion: number;
  currentEventVersion: number;
}): void {
  if (input.status !== "STAGED") {
    throw new DomainRuleError(
      "OUTAGE_RECOVERY_NOT_APPROVABLE",
      "Nur ein konfliktfrei simulierter, noch nicht freigegebener Batch kann freigegeben werden.",
    );
  }
  if (input.createdByDeviceId === input.approvedByDeviceId) {
    throw new DomainRuleError(
      "OUTAGE_RECOVERY_FOUR_EYES_REQUIRED",
      "Nacherfassung und Freigabe müssen durch unterschiedliche Geräte erfolgen.",
    );
  }
  if (input.currentEventVersion !== input.simulatedAgainstVersion + 1) {
    throw new DomainRuleError(
      "OUTAGE_RECOVERY_RESIMULATION_REQUIRED",
      "Der Livezustand wurde seit der Simulation geändert; der Batch muss neu simuliert werden.",
    );
  }
}

export function assertOutageRecoveryApplication(input: {
  status: "STAGED" | "CONFLICTED" | "APPROVED" | "APPLYING" | "APPLIED" | "REJECTED";
  simulatedAgainstVersion: number;
  currentEventVersion: number;
}): void {
  if (input.status !== "APPROVED") {
    throw new DomainRuleError(
      "OUTAGE_RECOVERY_NOT_APPLICABLE",
      "Nur ein im Vier-Augen-Prinzip freigegebener Batch kann angewendet werden.",
    );
  }
  if (input.currentEventVersion !== input.simulatedAgainstVersion + 2) {
    throw new DomainRuleError(
      "OUTAGE_RECOVERY_APPLICATION_STALE",
      "Der Livezustand wurde nach Freigabe geändert; der Batch darf nicht angewendet werden.",
    );
  }
}

const targetState: Readonly<Record<Exclude<OutageRecoveryEntryType, "PAPER_SALE">, RotationState>> =
  {
    ROTATION_CALLED: "CALLED",
    ROTATION_IN_FLIGHT: "IN_FLIGHT",
    ROTATION_LANDED: "LANDED",
    ROTATION_COMPLETED: "COMPLETED",
  };

interface RecoverySimulationContext {
  conflicts: OutageRecoveryConflict[];
  existingTicketKeys: ReadonlySet<string>;
  ids: Set<string>;
  recordedAtMs: number;
  references: Set<string>;
  sequences: Set<number>;
  states: Map<string, RotationState>;
  ticketKeys: Set<string>;
}

function addConflict(
  context: RecoverySimulationContext,
  entry: OutageRecoveryEntry,
  code: OutageRecoveryConflict["code"],
  message: string,
): void {
  context.conflicts.push({ entryId: entry.id, code, message });
}

function registerEntry(entry: OutageRecoveryEntry, context: RecoverySimulationContext): boolean {
  if (context.ids.has(entry.id)) {
    addConflict(
      context,
      entry,
      "DUPLICATE_ENTRY_ID",
      "Die Eintrags-ID kommt im Nacherfassungsbatch mehrfach vor.",
    );
    return false;
  }
  context.ids.add(entry.id);
  if (context.sequences.has(entry.paperSequence)) {
    addConflict(
      context,
      entry,
      "DUPLICATE_PAPER_SEQUENCE",
      "Die Papier-Belegfolge muss innerhalb des Batches eindeutig sein.",
    );
  }
  context.sequences.add(entry.paperSequence);
  if (Date.parse(entry.originalOccurredAt) > context.recordedAtMs) {
    addConflict(
      context,
      entry,
      "EVENT_IN_FUTURE",
      "Die ursprüngliche Ereigniszeit darf nicht nach der Nacherfassung liegen.",
    );
  }
  return true;
}

function recordPaperSale(entry: OutageRecoveryEntry, context: RecoverySimulationContext): void {
  if (context.references.has(entry.paperReference)) {
    addConflict(
      context,
      entry,
      "PAPER_REFERENCE_ALREADY_EXISTS",
      "Die Papier-Belegreferenz wurde bereits erfasst.",
    );
    return;
  }
  context.references.add(entry.paperReference);
  context.states.set(entry.paperReference, "DRAFT");
  for (const ticketKey of entry.ticketKeys ?? []) {
    if (context.ticketKeys.has(ticketKey)) {
      addConflict(
        context,
        entry,
        context.existingTicketKeys.has(ticketKey)
          ? "TICKET_CODE_ALREADY_EXISTS"
          : "DUPLICATE_TICKET_CODE",
        "Ein Ticketcode ist bereits vorhanden oder kommt im Batch mehrfach vor.",
      );
    }
    context.ticketKeys.add(ticketKey);
  }
}

function recordRotationEvent(
  entry: OutageRecoveryEntry,
  nextState: RotationState,
  context: RecoverySimulationContext,
): void {
  const current = context.states.get(entry.paperReference);
  if (!current) {
    addConflict(
      context,
      entry,
      "PAPER_REFERENCE_UNKNOWN",
      "Für das Umlaufereignis fehlt ein vorangehender Papierverkauf im Batch.",
    );
    return;
  }
  try {
    context.states.set(entry.paperReference, transitionRotation(current, nextState));
  } catch (reason) {
    if (!(reason instanceof DomainRuleError)) throw reason;
    addConflict(context, entry, "RECOVERY_TRANSITION_INVALID", reason.message);
  }
}

export function simulateOutageRecovery(input: {
  entries: readonly OutageRecoveryEntry[];
  existingPaperReferences: readonly string[];
  existingReferenceStates?: Readonly<Record<string, RotationState>>;
  existingTicketKeys?: readonly string[];
  recordedAt: string;
}): OutageRecoverySimulation {
  const orderedEntries = [...input.entries].sort(
    (left, right) =>
      Date.parse(left.originalOccurredAt) - Date.parse(right.originalOccurredAt) ||
      left.paperSequence - right.paperSequence ||
      left.id.localeCompare(right.id),
  );
  const existingTicketKeys = new Set(input.existingTicketKeys ?? []);
  const context: RecoverySimulationContext = {
    conflicts: [],
    existingTicketKeys,
    ids: new Set(),
    recordedAtMs: Date.parse(input.recordedAt),
    references: new Set(input.existingPaperReferences),
    sequences: new Set(),
    states: new Map(Object.entries(input.existingReferenceStates ?? {})),
    ticketKeys: new Set(existingTicketKeys),
  };

  for (const entry of orderedEntries) {
    if (!registerEntry(entry, context)) continue;
    if (entry.type === "PAPER_SALE") {
      recordPaperSale(entry, context);
      continue;
    }
    recordRotationEvent(entry, targetState[entry.type], context);
  }

  return {
    orderedEntries,
    conflicts: context.conflicts,
    canCommit: context.conflicts.length === 0,
  };
}
