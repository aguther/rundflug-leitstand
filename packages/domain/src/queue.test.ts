import { describe, expect, it } from "vitest";
import {
  assertManualGroupMoveAllowed,
  assertQueueMutationAllowed,
  deriveBookingGroupOperationalStatus,
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

  it("keeps a split booking group queued until its final segment has been called", () => {
    expect(
      deriveBookingGroupOperationalStatus({
        rotationStates: ["COMPLETED", "DRAFT"],
        pendingSegmentPresent: false,
      }),
    ).toBe("QUEUED");
    expect(
      deriveBookingGroupOperationalStatus({
        rotationStates: ["IN_FLIGHT", "DRAFT"],
        pendingSegmentPresent: true,
      }),
    ).toBe("PRESENT");
    expect(
      deriveBookingGroupOperationalStatus({
        rotationStates: ["COMPLETED", "CALLED"],
        pendingSegmentPresent: false,
      }),
    ).toBe("BOARDING");
    expect(
      deriveBookingGroupOperationalStatus({
        rotationStates: ["COMPLETED", "COMPLETED"],
        pendingSegmentPresent: false,
      }),
    ).toBe("COMPLETED");
  });

  it("derives every preserved, active and terminal booking-group state", () => {
    const derive = (
      rotationStates: Parameters<typeof deriveBookingGroupOperationalStatus>[0]["rotationStates"],
    ) => deriveBookingGroupOperationalStatus({ rotationStates, pendingSegmentPresent: false });

    expect(
      deriveBookingGroupOperationalStatus({
        rotationStates: ["DRAFT"],
        pendingSegmentPresent: false,
        preservedStatus: "MISSING",
      }),
    ).toBe("MISSING");
    expect(derive(["IN_FLIGHT"])).toBe("IN_FLIGHT");
    expect(derive(["LANDED"])).toBe("LANDED");
    expect(derive(["CANCELED", "CANCELED"])).toBe("CANCELED");
    expect(derive([])).toBe("QUEUED");
    expect(derive(["CANCELED", "COMPLETED"])).toBe("COMPLETED");
  });

  it("rejects invalid booking-group split inputs", () => {
    expect(() =>
      planBookingGroupSplit({ groupSize: 0, referenceCapacity: 4, splitAcknowledged: true }),
    ).toThrowError(/Gruppengröße/);
    expect(() =>
      planBookingGroupSplit({ groupSize: 4, referenceCapacity: 0, splitAcknowledged: true }),
    ).toThrowError(/Referenzkapazität/);
  });

  it("prioritizes standby groups and reports exhausted compatible capacity", () => {
    const plan = planNextRotations({
      groups: [
        { id: "regular", size: 2, queueSequence: 1, productId: "p1", standby: false },
        { id: "standby", size: 2, queueSequence: 2, productId: "p1", standby: true },
      ],
      aircraft: [{ id: "a1", capacity: 2, compatibleProductIds: ["p1"], available: true }],
      standbyPriority: true,
    });

    expect(plan.assignments[0]?.groupIds).toEqual(["standby"]);
    expect(plan.unassigned).toEqual([{ groupId: "regular", reason: "NO_CAPACITY" }]);
    expect(() =>
      planNextRotations({
        groups: [{ id: "invalid", size: 0, queueSequence: 1, productId: "p1", standby: false }],
        aircraft: [],
        standbyPriority: false,
      }),
    ).toThrowError(/Gruppengröße/);
  });

  it("rejects queue mutations once a rotation is in flight", () => {
    expect(() =>
      assertQueueMutationAllowed({ rotationState: "IN_FLIGHT", action: "CANCEL" }),
    ).toThrowError(/nach IM FLUG/);
    expect(() =>
      assertQueueMutationAllowed({ rotationState: "LANDED", action: "DEFER" }),
    ).toThrowError(/nach IM FLUG/);
    expect(() =>
      assertQueueMutationAllowed({ rotationState: "COMPLETED", action: "NO_SHOW" }),
    ).toThrowError(/nach IM FLUG/);
    expect(() =>
      assertQueueMutationAllowed({ rotationState: "DRAFT", action: "CANCEL" }),
    ).not.toThrow();
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
    expect(() =>
      assertManualGroupMoveAllowed({
        sourceStates: ["DRAFT"],
        targetState: "LANDED",
        sameResourceGroup: true,
        sameProduct: true,
        groupSize: 1,
        targetOccupiedSeats: 0,
        targetCapacity: 4,
      }),
    ).toThrowError(/nach IM FLUG/);
    expect(() =>
      assertManualGroupMoveAllowed({
        sourceStates: ["DRAFT"],
        targetState: "DRAFT",
        sameResourceGroup: false,
        sameProduct: true,
        groupSize: 1,
        targetOccupiedSeats: 0,
        targetCapacity: 4,
      }),
    ).toThrowError(/Ressourcengruppe/);
    expect(() =>
      assertManualGroupMoveAllowed({
        sourceStates: ["DRAFT"],
        targetState: "DRAFT",
        sameResourceGroup: true,
        sameProduct: false,
        groupSize: 1,
        targetOccupiedSeats: 0,
        targetCapacity: 4,
      }),
    ).toThrowError(/Produkte/);
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

  it("rejects invalid and unchanged usable capacities and invalid segments", () => {
    const base = {
      rotationState: "DRAFT" as const,
      called: false,
      baselineCapacity: 4,
      currentUsableCapacity: null,
      requestedUsableCapacity: 3,
      segments: [] as Array<{ ticketGroupId: string; size: number }>,
    };

    for (const requestedUsableCapacity of [0, 5, 2.5]) {
      expect(() =>
        planRotationCapacityReduction({ ...base, requestedUsableCapacity }),
      ).toThrowError(/Basiskapazität/);
    }
    expect(() =>
      planRotationCapacityReduction({
        ...base,
        currentUsableCapacity: 3,
      }),
    ).toThrowError(/bereits so eingestellt/);
    expect(() =>
      planRotationCapacityReduction({
        ...base,
        segments: [{ ticketGroupId: "invalid", size: 0 }],
      }),
    ).toThrowError(/gültige Größe/);
  });
});
