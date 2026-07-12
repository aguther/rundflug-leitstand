import { describe, expect, it } from "vitest";
import { type OutageRecoveryEntry, simulateOutageRecovery } from "./outage-recovery";

const at = (minute: number) => `2026-07-12T06:${minute.toString().padStart(2, "0")}:00.000Z`;

function entry(
  id: string,
  type: OutageRecoveryEntry["type"],
  minute: number,
  paperSequence: number,
  paperReference = "BELEG-001",
): OutageRecoveryEntry {
  return { id, type, originalOccurredAt: at(minute), paperSequence, paperReference };
}

describe("outage recovery simulation", () => {
  it("orders paper records by original time and paper sequence and accepts a complete lifecycle", () => {
    const result = simulateOutageRecovery({
      entries: [
        entry("landed", "ROTATION_LANDED", 20, 4),
        entry("sale", "PAPER_SALE", 0, 1),
        entry("completed", "ROTATION_COMPLETED", 25, 5),
        entry("called", "ROTATION_CALLED", 5, 2),
        entry("started", "ROTATION_IN_FLIGHT", 10, 3),
      ],
      existingPaperReferences: [],
      recordedAt: at(30),
    });

    expect(result.orderedEntries.map((item) => item.id)).toEqual([
      "sale",
      "called",
      "started",
      "landed",
      "completed",
    ]);
    expect(result).toMatchObject({ canCommit: true, conflicts: [] });
  });

  it("rejects logically impossible transitions instead of merging them", () => {
    const result = simulateOutageRecovery({
      entries: [entry("sale", "PAPER_SALE", 0, 1), entry("landed", "ROTATION_LANDED", 5, 2)],
      existingPaperReferences: [],
      recordedAt: at(30),
    });

    expect(result.canCommit).toBe(false);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({ entryId: "landed", code: "RECOVERY_TRANSITION_INVALID" }),
    );
  });

  it("rejects duplicate references, sequence collisions, unknown rotations and future events", () => {
    const result = simulateOutageRecovery({
      entries: [
        entry("duplicate-sale", "PAPER_SALE", 0, 1, "USED"),
        entry("unknown-call", "ROTATION_CALLED", 5, 1, "MISSING"),
        entry("future-sale", "PAPER_SALE", 40, 3, "FUTURE"),
      ],
      existingPaperReferences: ["USED"],
      recordedAt: at(30),
    });

    expect(result.canCommit).toBe(false);
    expect(result.conflicts.map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining([
        "PAPER_REFERENCE_ALREADY_EXISTS",
        "DUPLICATE_PAPER_SEQUENCE",
        "PAPER_REFERENCE_UNKNOWN",
        "EVENT_IN_FUTURE",
      ]),
    );
  });
});
