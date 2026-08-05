import { describe, expect, it } from "vitest";
import {
  type StoredDispatchBatchCandidateRow,
  selectReusableDispatchBatch,
} from "./dispatch-recommendation-selection";

function row(
  rotationId: string,
  groupId: string,
  ticketCount: number,
  overrides: Partial<StoredDispatchBatchCandidateRow> = {},
): StoredDispatchBatchCandidateRow {
  return {
    rotationId,
    groupIds: [groupId],
    productId: "product-a",
    gateId: "gate-a",
    ticketCount,
    attendanceStatus: "WAITING",
    firstEligibleSegment: true,
    reservedByActiveLease: false,
    planRevision: "plan-current",
    batchId: "batch-current",
    dispatchOrder: 1,
    dispatchWave: 1,
    plannedGroupIds: ["group-early", "group-pair"],
    plannedOccupiedSeats: 3,
    decisionReasons: ["CAPACITY_OPTIMIZED", "QUEUE_ORDER"],
    predictionUpdatedAt: "2026-08-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("selectReusableDispatchBatch", () => {
  it("keeps the current FIDS batch despite projected debt on another group", () => {
    const selection = selectReusableDispatchBatch({
      aircraftPassengerSeats: 3,
      rows: [
        row("rotation-early", "group-early", 1),
        row("rotation-pair", "group-pair", 2),
        row("rotation-between", "group-between", 1, {
          batchId: "batch-later",
          dispatchOrder: 2,
          plannedGroupIds: ["group-between"],
          plannedOccupiedSeats: 1,
          decisionReasons: ["MUST_SERVE_MAX_OVERTAKES"],
        }),
      ],
    });

    expect(selection).toEqual({
      batch: {
        planRevision: "plan-current",
        batchId: "batch-current",
        dispatchOrder: 1,
        memberRotationIds: ["rotation-early", "rotation-pair"],
        groupIds: ["group-early", "group-pair"],
        occupiedSeats: 3,
        decisionReasons: ["CAPACITY_OPTIMIZED", "QUEUE_ORDER"],
      },
      fallbackReason: null,
    });
  });

  it("skips a reserved batch and uses the next complete compatible batch", () => {
    const selection = selectReusableDispatchBatch({
      aircraftPassengerSeats: 3,
      rows: [
        row("rotation-early", "group-early", 1, { reservedByActiveLease: true }),
        row("rotation-pair", "group-pair", 2),
        row("rotation-next", "group-next", 3, {
          batchId: "batch-next",
          dispatchOrder: 2,
          plannedGroupIds: ["group-next"],
          plannedOccupiedSeats: 3,
        }),
      ],
    });

    expect(selection.batch?.groupIds).toEqual(["group-next"]);
    expect(selection.batch?.batchId).toBe("batch-next");
  });

  it("falls back when the stored batch is incomplete or too large", () => {
    const incomplete = selectReusableDispatchBatch({
      aircraftPassengerSeats: 3,
      rows: [row("rotation-early", "group-early", 1)],
    });
    expect(incomplete).toEqual({
      batch: null,
      fallbackReason: "CURRENT_PLAN_BATCH_INCOMPLETE",
    });

    const tooLarge = selectReusableDispatchBatch({
      aircraftPassengerSeats: 2,
      rows: [row("rotation-early", "group-early", 1), row("rotation-pair", "group-pair", 2)],
    });
    expect(tooLarge.batch).toBeNull();
    expect(tooLarge.fallbackReason).toBe("CURRENT_PLAN_BATCH_INCOMPATIBLE");
  });

  it("rejects segment-ineligible and product- or gate-mixed stored batches", () => {
    expect(
      selectReusableDispatchBatch({
        aircraftPassengerSeats: 3,
        rows: [
          row("rotation-early", "group-early", 1, { firstEligibleSegment: false }),
          row("rotation-pair", "group-pair", 2),
        ],
      }).fallbackReason,
    ).toBe("CURRENT_PLAN_BATCH_INCOMPLETE");

    expect(
      selectReusableDispatchBatch({
        aircraftPassengerSeats: 3,
        rows: [
          row("rotation-early", "group-early", 1),
          row("rotation-pair", "group-pair", 2, { productId: "product-b" }),
        ],
      }).fallbackReason,
    ).toBe("CURRENT_PLAN_BATCH_INCOMPATIBLE");

    expect(
      selectReusableDispatchBatch({
        aircraftPassengerSeats: 3,
        rows: [
          row("rotation-early", "group-early", 1),
          row("rotation-pair", "group-pair", 2, { gateId: "gate-b" }),
        ],
      }).fallbackReason,
    ).toBe("CURRENT_PLAN_BATCH_INCOMPATIBLE");
  });
});
