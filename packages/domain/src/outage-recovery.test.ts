import { describe, expect, it } from "vitest";
import {
  assertMayStageOutageRecoveryEntry,
  assertOutageRecoveryApplication,
  assertOutageRecoveryApproval,
  type OutageRecoveryEntry,
  simulateOutageRecovery,
} from "./outage-recovery";

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
  it("applies only an approved batch before another live write occurs", () => {
    expect(() =>
      assertOutageRecoveryApplication({
        status: "APPROVED",
        simulatedAgainstVersion: 20,
        currentEventVersion: 22,
      }),
    ).not.toThrow();
    expect(() =>
      assertOutageRecoveryApplication({
        status: "STAGED",
        simulatedAgainstVersion: 20,
        currentEventVersion: 21,
      }),
    ).toThrowError(/Vier-Augen/);
    expect(() =>
      assertOutageRecoveryApplication({
        status: "APPROVED",
        simulatedAgainstVersion: 20,
        currentEventVersion: 23,
      }),
    ).toThrowError(/nach Freigabe geändert/);
  });

  it("requires a different approving device and an unchanged post-staging event version", () => {
    expect(() =>
      assertOutageRecoveryApproval({
        status: "STAGED",
        createdByDeviceId: "cashier-1",
        approvedByDeviceId: "admin-2",
        simulatedAgainstVersion: 20,
        currentEventVersion: 21,
      }),
    ).not.toThrow();
    expect(() =>
      assertOutageRecoveryApproval({
        status: "STAGED",
        createdByDeviceId: "admin-1",
        approvedByDeviceId: "admin-1",
        simulatedAgainstVersion: 20,
        currentEventVersion: 21,
      }),
    ).toThrowError(/unterschiedliche Geräte/);
    expect(() =>
      assertOutageRecoveryApproval({
        status: "STAGED",
        createdByDeviceId: "cashier-1",
        approvedByDeviceId: "admin-2",
        simulatedAgainstVersion: 20,
        currentEventVersion: 22,
      }),
    ).toThrowError(/neu simuliert/);
    expect(() =>
      assertOutageRecoveryApproval({
        status: "CONFLICTED",
        createdByDeviceId: "cashier-1",
        approvedByDeviceId: "admin-2",
        simulatedAgainstVersion: 20,
        currentEventVersion: 21,
      }),
    ).toThrowError(/konfliktfrei/);
  });

  it("separates cashier paper sales from flight-line-lead rotation records", () => {
    expect(() => assertMayStageOutageRecoveryEntry("CASHIER", "PAPER_SALE")).not.toThrow();
    expect(() => assertMayStageOutageRecoveryEntry("CASHIER", "ROTATION_CALLED")).toThrowError(
      /Leiter Flight Line/,
    );
    expect(() => assertMayStageOutageRecoveryEntry("FLIGHT_DIRECTOR", "PAPER_SALE")).toThrowError(
      /Kasse/,
    );
    expect(() =>
      assertMayStageOutageRecoveryEntry("FLIGHT_DIRECTOR", "ROTATION_LANDED"),
    ).not.toThrow();
  });

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

  it("detects ticket codes reused in history or within the paper batch", () => {
    const result = simulateOutageRecovery({
      entries: [
        { ...entry("sale-1", "PAPER_SALE", 0, 1, "BELEG-1"), ticketKeys: ["used", "same"] },
        { ...entry("sale-2", "PAPER_SALE", 1, 2, "BELEG-2"), ticketKeys: ["same"] },
      ],
      existingPaperReferences: [],
      existingTicketKeys: ["used"],
      recordedAt: at(30),
    });

    expect(result.conflicts.map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining(["TICKET_CODE_ALREADY_EXISTS", "DUPLICATE_TICKET_CODE"]),
    );
  });

  it("continues a flight-line batch from an already applied cashier paper sale", () => {
    const result = simulateOutageRecovery({
      entries: [
        entry("called", "ROTATION_CALLED", 5, 1),
        entry("started", "ROTATION_IN_FLIGHT", 10, 2),
      ],
      existingPaperReferences: ["BELEG-001"],
      existingReferenceStates: { "BELEG-001": "DRAFT" },
      recordedAt: at(30),
    });

    expect(result).toMatchObject({ canCommit: true, conflicts: [] });
  });
});
