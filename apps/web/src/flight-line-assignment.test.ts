import type { OperationBoard } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import {
  dispatchRecommendationForAircraft,
  dispatchRecommendationSelectionForAircraft,
} from "./flight-line-assignment";

function rotation(
  id: string,
  aircraftId: string,
  dispatchOrder: number,
  groupIds: string[],
  status: "DRAFT" | "CALLED" = "DRAFT",
) {
  return {
    id,
    status,
    timeline: { forecastAssumedAircraftId: aircraftId },
    dispatchPlan: {
      revision: "revision-1",
      batchId: `batch-${id}`,
      dispatchOrder,
      groupIds,
      occupiedSeats: 3,
      availableSeats: 0,
      decisionReasons: ["QUEUE_ORDER"],
    },
  };
}

describe("Flight Director dispatch assignment", () => {
  it("returns the first current draft recommendation for the requested aircraft", () => {
    const board = {
      rotations: [
        rotation("later-a", "aircraft-a", 3, ["group-3"]),
        rotation("first-b", "aircraft-b", 2, ["group-4", "group-5"]),
        rotation("first-a", "aircraft-a", 1, ["group-1", "group-2"]),
        rotation("called-a", "aircraft-a", 0, ["stale-group"], "CALLED"),
      ],
    } as unknown as OperationBoard;

    expect(dispatchRecommendationForAircraft(board, "aircraft-a")).toMatchObject({
      batchId: "batch-first-a",
      groupIds: ["group-1", "group-2"],
    });
  });

  it("returns one complete replacement selection and clears it without a recommendation", () => {
    const board = {
      rotations: [rotation("first-a", "aircraft-a", 1, ["group-1", "group-2"])],
    } as unknown as OperationBoard;

    const selected = dispatchRecommendationSelectionForAircraft(board, "aircraft-a");
    expect(selected.groupIds).toEqual(["group-1", "group-2"]);
    expect(selected.groupIds).not.toBe(selected.recommendation?.groupIds);
    expect(dispatchRecommendationSelectionForAircraft(board, "aircraft-b")).toEqual({
      recommendation: null,
      groupIds: [],
    });
  });
});
