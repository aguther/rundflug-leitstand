import { describe, expect, it } from "vitest";
import {
  assertManualGroupMoveAllowed,
  assertQueueMutationAllowed,
  deriveResourceGroupCapacity,
  planBookingGroupSplit,
  planNextRotations,
  planRotationCapacityReduction,
} from "./queue";

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

  it("derives group capacity from the largest assigned aircraft", () => {
    expect(deriveResourceGroupCapacity([1, 3, 2])).toBe(3);
    expect(deriveResourceGroupCapacity([])).toBe(0);
    expect(deriveResourceGroupCapacity([0, -1, Number.NaN])).toBe(0);
  });

  it("uses the smallest fitting aircraft and preserves larger aircraft for larger groups", () => {
    const plan = planNextRotations({
      groups: [
        { id: "single", size: 1, queueSequence: 1, productId: "p1", standby: false },
        { id: "family", size: 3, queueSequence: 2, productId: "p1", standby: false },
      ],
      aircraft: [
        { id: "large", capacity: 3, compatibleProductIds: ["p1"], available: true },
        { id: "small", capacity: 1, compatibleProductIds: ["p1"], available: true },
      ],
      standbyPriority: false,
    });

    expect(plan.assignments).toEqual([
      { aircraftId: "small", groupIds: ["single"], occupiedSeats: 1 },
      { aircraftId: "large", groupIds: ["family"], occupiedSeats: 3 },
    ]);
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

  it("allows a reasoned whole-group move until takeoff and protects target capacity", () => {
    expect(() =>
      assertManualGroupMoveAllowed({
        sourceStates: ["DRAFT"],
        targetState: "CALLED",
        sameResourceGroup: true,
        sameProduct: true,
        groupSize: 2,
        targetOccupiedSeats: 2,
        targetCapacity: 4,
      }),
    ).not.toThrow();
    expect(() =>
      assertManualGroupMoveAllowed({
        sourceStates: ["DRAFT"],
        targetState: "DRAFT",
        sameResourceGroup: true,
        sameProduct: true,
        groupSize: 3,
        targetOccupiedSeats: 2,
        targetCapacity: 4,
      }),
    ).toThrowError(/gesamte Buchungsgruppe/);
    expect(() =>
      assertManualGroupMoveAllowed({
        sourceStates: ["IN_FLIGHT"],
        targetState: "DRAFT",
        sameResourceGroup: true,
        sameProduct: true,
        groupSize: 1,
        targetOccupiedSeats: 0,
        targetCapacity: 4,
      }),
    ).toThrowError(/nach IM FLUG/);
  });

  it("reduces a draft rotation by evicting only a whole queue suffix", () => {
    expect(
      planRotationCapacityReduction({
        rotationState: "DRAFT",
        called: false,
        baselineCapacity: 4,
        currentUsableCapacity: null,
        requestedUsableCapacity: 3,
        segments: [
          { ticketGroupId: "first", size: 2 },
          { ticketGroupId: "second", size: 2 },
          { ticketGroupId: "third", size: 1 },
        ],
      }),
    ).toEqual({ keptGroupIds: ["first"], evictedGroupIds: ["second", "third"], occupiedSeats: 2 });
    expect(() =>
      planRotationCapacityReduction({
        rotationState: "CALLED",
        called: true,
        baselineCapacity: 4,
        currentUsableCapacity: null,
        requestedUsableCapacity: 3,
        segments: [{ ticketGroupId: "first", size: 2 }],
      }),
    ).toThrowError(/nur vor dem Aufruf/);
  });
});
