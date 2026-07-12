import { DomainRuleError, type RotationState, transitionRotation } from "./index";

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
}

export interface OutageRecoveryConflict {
  entryId: string;
  code:
    | "DUPLICATE_ENTRY_ID"
    | "DUPLICATE_PAPER_SEQUENCE"
    | "EVENT_IN_FUTURE"
    | "PAPER_REFERENCE_ALREADY_EXISTS"
    | "PAPER_REFERENCE_UNKNOWN"
    | "RECOVERY_TRANSITION_INVALID";
  message: string;
}

export interface OutageRecoverySimulation {
  orderedEntries: OutageRecoveryEntry[];
  conflicts: OutageRecoveryConflict[];
  canCommit: boolean;
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
  const states = new Map<string, RotationState>();
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
