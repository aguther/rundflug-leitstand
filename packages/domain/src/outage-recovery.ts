import { type DeviceRole, DomainRuleError, type RotationState, transitionRotation } from "./index";

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
  const conflicts: OutageRecoveryConflict[] = [];
  const ids = new Set<string>();
  const sequences = new Set<number>();
  const references = new Set(input.existingPaperReferences);
  const states = new Map<string, RotationState>(
    Object.entries(input.existingReferenceStates ?? {}),
  );
  const ticketKeys = new Set(input.existingTicketKeys ?? []);
  const recordedAtMs = Date.parse(input.recordedAt);

  for (const entry of orderedEntries) {
    if (ids.has(entry.id)) {
      conflicts.push({
        entryId: entry.id,
        code: "DUPLICATE_ENTRY_ID",
        message: "Die Eintrags-ID kommt im Nacherfassungsbatch mehrfach vor.",
      });
      continue;
    }
    ids.add(entry.id);
    if (sequences.has(entry.paperSequence)) {
      conflicts.push({
        entryId: entry.id,
        code: "DUPLICATE_PAPER_SEQUENCE",
        message: "Die Papier-Belegfolge muss innerhalb des Batches eindeutig sein.",
      });
    }
    sequences.add(entry.paperSequence);
    if (Date.parse(entry.originalOccurredAt) > recordedAtMs) {
      conflicts.push({
        entryId: entry.id,
        code: "EVENT_IN_FUTURE",
        message: "Die ursprüngliche Ereigniszeit darf nicht nach der Nacherfassung liegen.",
      });
    }

    if (entry.type === "PAPER_SALE") {
      if (references.has(entry.paperReference)) {
        conflicts.push({
          entryId: entry.id,
          code: "PAPER_REFERENCE_ALREADY_EXISTS",
          message: "Die Papier-Belegreferenz wurde bereits erfasst.",
        });
        continue;
      }
      references.add(entry.paperReference);
      states.set(entry.paperReference, "DRAFT");
      for (const ticketKey of entry.ticketKeys ?? []) {
        if (ticketKeys.has(ticketKey)) {
          conflicts.push({
            entryId: entry.id,
            code: (input.existingTicketKeys ?? []).includes(ticketKey)
              ? "TICKET_CODE_ALREADY_EXISTS"
              : "DUPLICATE_TICKET_CODE",
            message: "Ein Ticketcode ist bereits vorhanden oder kommt im Batch mehrfach vor.",
          });
        }
        ticketKeys.add(ticketKey);
      }
      continue;
    }

    const current = states.get(entry.paperReference);
    if (!current) {
      conflicts.push({
        entryId: entry.id,
        code: "PAPER_REFERENCE_UNKNOWN",
        message: "Für das Umlaufereignis fehlt ein vorangehender Papierverkauf im Batch.",
      });
      continue;
    }
    try {
      states.set(entry.paperReference, transitionRotation(current, targetState[entry.type]));
    } catch (reason) {
      if (!(reason instanceof DomainRuleError)) throw reason;
      conflicts.push({
        entryId: entry.id,
        code: "RECOVERY_TRANSITION_INVALID",
        message: reason.message,
      });
    }
  }

  return { orderedEntries, conflicts, canCommit: conflicts.length === 0 };
}
