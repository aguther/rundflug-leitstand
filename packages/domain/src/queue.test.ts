import { describe, expect, it } from "vitest";
import { assertQueueMutationAllowed, planBookingGroupSplit, planNextRotations } from "./queue";

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

  it("preserves one sales order across products sharing a resource-group queue", () => {
    const plan = planNextRotations({
      groups: [
        { id: "later-p1", size: 1, queueSequence: 3, productId: "p1", standby: false },
        { id: "first-p2", size: 1, queueSequence: 1, productId: "p2", standby: false },
        { id: "second-p1", size: 1, queueSequence: 2, productId: "p1", standby: false },
      ],
      aircraft: [{ id: "a1", capacity: 3, compatibleProductIds: ["p1", "p2"], available: true }],
      standbyPriority: false,
    });

    expect(plan.assignments[0]?.groupIds).toEqual(["first-p2", "second-p1", "later-p1"]);
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

  it("splits an oversized booking group only after explicit acknowledgement", () => {
    expect(() =>
      planBookingGroupSplit({ groupSize: 5, referenceCapacity: 4, splitAcknowledged: false }),
    ).toThrowError(/ausdrücklich bestätigt/);
    expect(
      planBookingGroupSplit({ groupSize: 9, referenceCapacity: 4, splitAcknowledged: true }),
    ).toEqual({ slotSizes: [4, 4, 1], splitAcknowledged: true });
    expect(
      planBookingGroupSplit({ groupSize: 4, referenceCapacity: 4, splitAcknowledged: false }),
    ).toEqual({ slotSizes: [4], splitAcknowledged: false });
  });

  it("rejects queue mutations once a rotation is in flight", () => {
    expect(() =>
      assertQueueMutationAllowed({ rotationState: "IN_FLIGHT", action: "REBOOK" }),
    ).toThrowError(/nach IM FLUG/);
  });
});
