import { describe, expect, it } from "vitest";
import { assertQueueMutationAllowed, planNextRotations } from "./queue";

describe("resource-group queue planning", () => {
  it("keeps purchased groups together and fills compatible aircraft in order", () => {
    const plan = planNextRotations({
      groups: [
        { id: "g1", size: 3, queueSequence: 1, productId: "p1", standby: false },
        { id: "g2", size: 1, queueSequence: 2, productId: "p1", standby: false },
      ],
      aircraft: [{ id: "a1", capacity: 4, compatibleProductIds: ["p1"], available: true }],
      standbyPriority: false,
    });
    expect(plan.assignments[0]?.groupIds).toEqual(["g1", "g2"]);
    expect(plan.assignments[0]?.occupiedSeats).toBe(4);
  });

  it("never splits a group that is larger than every compatible aircraft", () => {
    const plan = planNextRotations({
      groups: [{ id: "family", size: 5, queueSequence: 1, productId: "p1", standby: false }],
      aircraft: [{ id: "a1", capacity: 4, compatibleProductIds: ["p1"], available: true }],
      standbyPriority: false,
    });
    expect(plan.assignments[0]?.groupIds).toEqual([]);
    expect(plan.unassigned).toEqual([{ groupId: "family", reason: "GROUP_TOO_LARGE" }]);
  });

  it("rejects queue mutations once a rotation is in flight", () => {
    expect(() =>
      assertQueueMutationAllowed({ rotationState: "IN_FLIGHT", action: "REBOOK" }),
    ).toThrowError(/nach IM FLUG/);
  });
});
