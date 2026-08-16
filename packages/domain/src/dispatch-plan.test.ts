import { describe, expect, it } from "vitest";
import {
  calculateConfirmedOvertakeIncrements,
  createDispatchPlan,
  DEFAULT_DISPATCH_PLANNING_LIMITS,
  type DispatchGroupInput,
  type DispatchLaneInput,
} from "./dispatch-plan";

describe("calculateConfirmedOvertakeIncrements", () => {
  it("counts only later rotations that were actually selected", () => {
    expect(
      calculateConfirmedOvertakeIncrements({
        selectedMembers: [
          { rotationId: "selected-middle", queueSequence: 3 },
          { rotationId: "selected-later", queueSequence: 5 },
        ],
        waitingMembers: [
          { rotationId: "waiting-first", queueSequence: 1 },
          { rotationId: "waiting-between", queueSequence: 4 },
          { rotationId: "waiting-later", queueSequence: 6 },
        ],
      }),
    ).toEqual([
      { rotationId: "waiting-between", increment: 1 },
      { rotationId: "waiting-first", increment: 2 },
    ]);
  });

  it("never counts a selected member as overtaken", () => {
    expect(
      calculateConfirmedOvertakeIncrements({
        selectedMembers: [{ rotationId: "selected", queueSequence: 2 }],
        waitingMembers: [
          { rotationId: "selected", queueSequence: 2 },
          { rotationId: "later", queueSequence: 3 },
        ],
      }),
    ).toEqual([]);
  });
});

const NOW = "2026-07-31T10:00:00.000Z";

function group(
  id: string,
  size: number,
  queueSequence: number,
  overrides: Partial<DispatchGroupInput> = {},
): DispatchGroupInput {
  return {
    id,
    groupIds: [`booking-${id}`],
    size,
    productId: "short-flight",
    resourceGroupId: "touring",
    gateId: "gate-a",
    queueSequence,
    soldAt: new Date(Date.parse(NOW) - (40 - queueSequence) * 60_000).toISOString(),
    attendanceStatus: "WAITING",
    standby: false,
    publicStatus: "WAITING",
    ...overrides,
  };
}

function lane(
  id: string,
  passengerSeats: number,
  overrides: Partial<DispatchLaneInput> = {},
): DispatchLaneInput {
  return {
    id,
    aircraftId: `aircraft-${id}`,
    pilotId: `pilot-${id}`,
    resourceGroupId: "touring",
    passengerSeats,
    availableLowerAt: NOW,
    availableExpectedAt: NOW,
    availableUpperAt: NOW,
    productDurations: [
      { productId: "short-flight", lowerMinutes: 20, expectedMinutes: 24, upperMinutes: 28 },
      { productId: "long-flight", lowerMinutes: 35, expectedMinutes: 40, upperMinutes: 48 },
    ],
    ...overrides,
  };
}

describe("createDispatchPlan", () => {
  it("rejects an invalid waiting timestamp as a type error", () => {
    expect(() =>
      createDispatchPlan({
        now: NOW,
        groups: [group("invalid-time", 1, 1, { waitingSince: "not-a-timestamp" })],
        lanes: [lane("available", 3)],
      }),
    ).toThrow(TypeError);
  });

  it("fills a targeted three-seat wave with the compatible one- and two-person groups", () => {
    const plan = createDispatchPlan({
      now: NOW,
      groups: [group("first-single", 1, 1), group("second-pair", 2, 2)],
      lanes: [lane("opened-aircraft", 3)],
      limits: { maximumWaves: 1 },
    });

    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]).toMatchObject({
      memberIds: ["first-single", "second-pair"],
      occupiedSeats: 3,
      availableSeats: 0,
      wave: 1,
    });
  });

  it("combines complete groups without allowing a large group to starve", () => {
    const first = createDispatchPlan({
      now: NOW,
      groups: [
        group("one-a", 1, 1),
        group("one-b", 1, 2),
        group("large", 3, 3),
        group("one-c", 1, 4),
      ],
      lanes: [lane("three-seater", 3)],
      limits: { maximumWaves: 2 },
    });

    expect(first.batches.map((batch) => batch.memberIds)).toEqual([
      ["one-a", "one-b", "one-c"],
      ["large"],
    ]);
    expect(first.batches.map((batch) => batch.occupiedSeats)).toEqual([3, 3]);

    const next = createDispatchPlan({
      now: "2026-07-31T10:30:00.000Z",
      groups: [
        group("large", 3, 1, {
          confirmedOvertakeCount: DEFAULT_DISPATCH_PLANNING_LIMITS.maximumOvertakes,
        }),
        group("new-one-a", 1, 2),
        group("new-one-b", 1, 3),
        group("new-one-c", 1, 4),
      ],
      lanes: [lane("three-seater", 3)],
      limits: { maximumWaves: 1 },
    });
    expect(next.batches[0]?.memberIds).toEqual(["large"]);
    expect(next.batches[0]?.decisionReasons).toContain("MUST_SERVE_MAX_OVERTAKES");
  });

  it("plans four simultaneous three-seat lanes as one twelve-seat wave", () => {
    const plan = createDispatchPlan({
      now: NOW,
      groups: Array.from({ length: 12 }, (_, index) => group(`single-${index + 1}`, 1, index + 1)),
      lanes: Array.from({ length: 4 }, (_, index) => lane(`lane-${index + 1}`, 3)),
      limits: { maximumWaves: 1 },
    });

    expect(plan.batches).toHaveLength(4);
    expect(plan.batches.reduce((sum, batch) => sum + batch.occupiedSeats, 0)).toBe(12);
    expect(new Set(plan.batches.flatMap((batch) => batch.memberIds)).size).toBe(12);
    expect(plan.batches.every((batch) => batch.wave === 1)).toBe(true);
  });

  it("keeps the earliest fitting group in the first equally full four-lane wave", () => {
    const planningTime = "2026-07-31T17:42:54.000Z";
    const soldGroups = [
      ["101", 1, "2026-07-31T17:37:30.268Z"],
      ["102", 2, "2026-07-31T17:37:31.503Z"],
      ["103", 2, "2026-07-31T17:37:33.648Z"],
      ["104", 1, "2026-07-31T17:37:34.859Z"],
      ["105", 3, "2026-07-31T17:37:36.154Z"],
      ["106", 3, "2026-07-31T17:37:37.370Z"],
      ["107", 1, "2026-07-31T17:37:39.125Z"],
      ["108", 1, "2026-07-31T17:37:39.888Z"],
      ["109", 2, "2026-07-31T17:37:41.427Z"],
    ] as const;
    const groups = soldGroups.map(([id, size, soldAt], index) =>
      group(id, size, index + 1, { soldAt, waitingSince: soldAt }),
    );
    const lanes = Array.from({ length: 4 }, (_, index) =>
      lane(`historical-${index + 1}`, 3, {
        availableLowerAt: planningTime,
        availableExpectedAt: planningTime,
        availableUpperAt: planningTime,
      }),
    );

    const plan = createDispatchPlan({
      now: planningTime,
      groups,
      lanes,
      limits: { maximumWaves: 2 },
    });
    const firstWave = plan.batches
      .filter((batch) => batch.wave === 1)
      .map((batch) => [...batch.memberIds].sort().join("+"))
      .sort();

    expect(firstWave).toEqual(["101+102", "103+104", "105", "106"]);
    expect(plan.groupDecisions.find((decision) => decision.memberId === "101")).toMatchObject({
      projectedOvertakeCount: 0,
    });
  });

  it("replaces an equally full provisional waiting plan as earlier fitting groups arrive", () => {
    const planningTime = "2026-07-31T17:42:54.000Z";
    const soldGroups = [
      ["101", 1, "2026-07-31T17:37:30.268Z"],
      ["102", 2, "2026-07-31T17:37:31.503Z"],
      ["103", 2, "2026-07-31T17:37:33.648Z"],
      ["104", 1, "2026-07-31T17:37:34.859Z"],
      ["105", 3, "2026-07-31T17:37:36.154Z"],
      ["106", 3, "2026-07-31T17:37:37.370Z"],
      ["107", 1, "2026-07-31T17:37:39.125Z"],
      ["108", 1, "2026-07-31T17:37:39.888Z"],
      ["109", 2, "2026-07-31T17:37:41.427Z"],
    ] as const;
    const lanes = Array.from({ length: 4 }, (_, index) =>
      lane(`incremental-${index + 1}`, 3, {
        availableLowerAt: planningTime,
        availableExpectedAt: planningTime,
        availableUpperAt: planningTime,
      }),
    );
    let previousPlan = null;
    for (let count = 1; count <= soldGroups.length; count += 1) {
      previousPlan = createDispatchPlan({
        now: planningTime,
        groups: soldGroups
          .slice(0, count)
          .map(([id, size, soldAt], index) =>
            group(id, size, index + 1, { soldAt, waitingSince: soldAt }),
          ),
        lanes,
        previousPlan,
        limits: { maximumWaves: 2 },
      });
    }
    if (!previousPlan) throw new Error("Incremental dispatch plan was not created.");

    expect(
      previousPlan.batches
        .filter((batch) => batch.wave === 1)
        .map((batch) => [...batch.memberIds].sort().join("+"))
        .sort(),
    ).toEqual(["101+102", "103+104", "105", "106"]);
  });

  it("uses a one-seater for a single group and preserves the larger lane", () => {
    const plan = createDispatchPlan({
      now: NOW,
      groups: [group("large", 3, 1), group("single", 1, 2)],
      lanes: [lane("single-seat", 1), lane("three-seat", 3)],
      limits: { maximumWaves: 1 },
    });

    expect(plan.batches.find((batch) => batch.laneId === "single-seat")?.memberIds).toEqual([
      "single",
    ]);
    expect(plan.batches.find((batch) => batch.laneId === "three-seat")?.memberIds).toEqual([
      "large",
    ]);
  });

  it("serves a longer product when its service deficit becomes material", () => {
    const plan = createDispatchPlan({
      now: NOW,
      groups: [
        group("short-a", 1, 1),
        group("short-b", 1, 2),
        group("short-c", 1, 3),
        group("long", 2, 4, {
          productId: "long-flight",
          productServiceDeficit: 500,
        }),
      ],
      lanes: [lane("three-seat", 3)],
      limits: { maximumWaves: 1 },
    });

    expect(plan.batches[0]?.productId).toBe("long-flight");
    expect(plan.batches[0]?.decisionReasons).toContain("PRODUCT_FAIRNESS");
  });

  it("enforces maximum waiting time ahead of newly arriving small groups", () => {
    const oldWaitingAt = new Date(
      Date.parse(NOW) - DEFAULT_DISPATCH_PLANNING_LIMITS.maximumWaitMinutes * 60_000,
    ).toISOString();
    const plan = createDispatchPlan({
      now: NOW,
      groups: [
        group("old-large", 3, 1, { waitingSince: oldWaitingAt }),
        group("new-a", 1, 2, { waitingSince: NOW }),
        group("new-b", 1, 3, { waitingSince: NOW }),
        group("new-c", 1, 4, { waitingSince: NOW }),
      ],
      lanes: [lane("three-seat", 3)],
      limits: { maximumWaves: 1 },
    });

    expect(plan.batches[0]?.memberIds).toEqual(["old-large"]);
    expect(plan.batches[0]?.decisionReasons).toContain("MUST_SERVE_MAX_WAIT");
  });

  it("prefers more passengers before minimizing projected overtakes at equal higher priorities", () => {
    const plan = createDispatchPlan({
      now: NOW,
      groups: [group("early-a", 1, 1), group("early-b", 1, 2), group("full", 3, 3)],
      lanes: [lane("three-seat", 3)],
      limits: { maximumWaves: 1 },
    });

    expect(plan.batches[0]?.memberIds).toEqual(["full"]);
    expect(plan.batches[0]?.decisionDetails).toMatchObject({
      occupiedSeats: 3,
      availableSeats: 0,
      projectedOvertakes: 2,
    });
  });

  it("accepts a fair partial load when the maximum-wait group cannot mix products", () => {
    const oldWaitingAt = new Date(
      Date.parse(NOW) - DEFAULT_DISPATCH_PLANNING_LIMITS.maximumWaitMinutes * 60_000,
    ).toISOString();
    const plan = createDispatchPlan({
      now: NOW,
      groups: [
        group("old-long-pair", 2, 1, {
          productId: "long-flight",
          waitingSince: oldWaitingAt,
        }),
        group("new-short-a", 1, 2, { waitingSince: NOW }),
        group("new-short-b", 1, 3, { waitingSince: NOW }),
        group("new-short-c", 1, 4, { waitingSince: NOW }),
      ],
      lanes: [lane("three-seater", 3)],
      limits: { maximumWaves: 1 },
    });

    expect(plan.batches[0]).toMatchObject({
      memberIds: ["old-long-pair"],
      occupiedSeats: 2,
      availableSeats: 1,
    });
    expect(plan.batches[0]?.decisionReasons).toContain("MUST_SERVE_MAX_WAIT");
  });

  it("keeps a PREPARE batch stable across a small forecast change", () => {
    const groups = [
      group("prepare-a", 1, 1, { publicStatus: "PREPARE" }),
      group("prepare-b", 1, 2, { publicStatus: "PREPARE" }),
      group("waiting", 1, 3),
      group("later", 3, 4),
    ];
    const first = createDispatchPlan({
      now: NOW,
      groups,
      lanes: [lane("three-seat", 3)],
      limits: { maximumWaves: 2 },
    });
    const shiftedLane = lane("three-seat", 3, {
      availableLowerAt: "2026-07-31T10:01:00.000Z",
      availableExpectedAt: "2026-07-31T10:02:00.000Z",
      availableUpperAt: "2026-07-31T10:03:00.000Z",
    });
    const second = createDispatchPlan({
      now: "2026-07-31T10:00:30.000Z",
      groups,
      lanes: [shiftedLane],
      previousPlan: first,
      limits: { maximumWaves: 2 },
    });

    expect(second.planId).toBe(first.planId);
    expect(second.batches.map((batch) => batch.memberIds)).toEqual(
      first.batches.map((batch) => batch.memberIds),
    );
  });

  it("keeps a called group early without binding it to the previous aircraft lane", () => {
    const first = createDispatchPlan({
      now: NOW,
      groups: [group("called", 1, 1), group("filler", 2, 2), group("later", 3, 3)],
      lanes: [lane("lane-a", 3), lane("lane-b", 3)],
      limits: { maximumWaves: 2 },
    });
    const committedGroups = [
      group("called", 1, 1, { publicStatus: "COME_TO_FLIGHT_LINE" }),
      group("new-small", 1, 1),
      group("filler", 2, 2),
      group("later", 3, 3),
    ];
    const previousBatch = first.batches.find((batch) => batch.memberIds.includes("called"));
    const second = createDispatchPlan({
      now: "2026-07-31T10:00:30.000Z",
      groups: committedGroups,
      lanes: [
        lane("lane-a", 3, {
          availableLowerAt: "2026-07-31T10:20:00.000Z",
          availableExpectedAt: "2026-07-31T10:20:00.000Z",
          availableUpperAt: "2026-07-31T10:20:00.000Z",
        }),
        lane("lane-b", 3),
      ],
      previousPlan: first,
      limits: { maximumWaves: 2 },
    });
    const committedBatch = second.batches.find((batch) => batch.memberIds.includes("called"));

    expect(previousBatch).toBeDefined();
    expect(committedBatch?.dispatchOrder).toBe(1);
    expect(committedBatch?.laneId).toBe("lane-b");
  });

  it("puts every guest into the first three-aircraft wave for the reported queue", () => {
    const calledGroups = [
      group("0106", 1, 1, { publicStatus: "COME_TO_FLIGHT_LINE" }),
      group("0107", 2, 2, { publicStatus: "COME_TO_FLIGHT_LINE" }),
      group("0108", 2, 3, { publicStatus: "COME_TO_FLIGHT_LINE" }),
      group("0112", 2, 4, { publicStatus: "COME_TO_FLIGHT_LINE" }),
      group("0113", 1, 5, { publicStatus: "COME_TO_FLIGHT_LINE" }),
    ];
    const laterAt = "2026-07-31T10:20:00.000Z";
    const plan = createDispatchPlan({
      now: NOW,
      groups: calledGroups,
      lanes: [
        lane("available-a", 3),
        lane("available-b", 3),
        lane("available-c", 3),
        lane("later", 3, {
          availableLowerAt: laterAt,
          availableExpectedAt: laterAt,
          availableUpperAt: laterAt,
        }),
      ],
      limits: { maximumWaves: 1 },
    });

    const immediateBatches = plan.batches.filter((batch) => batch.boardingWindowExpectedAt === NOW);
    expect(immediateBatches).toHaveLength(3);
    expect(immediateBatches.reduce((sum, batch) => sum + batch.occupiedSeats, 0)).toBe(8);
    expect(immediateBatches[0]?.memberIds).toEqual(["0106", "0107"]);
    expect(plan.groupDecisions.find((decision) => decision.memberId === "0112")).toBeDefined();
  });

  it("keeps the batch identity when an equally capable aircraft returns first", () => {
    const groups = [group("first", 1, 1), group("pair", 2, 2), group("later", 3, 3)];
    const delayedAt = "2026-07-31T10:20:00.000Z";
    const delayedLane = (id: string) =>
      lane(id, 3, {
        availableLowerAt: delayedAt,
        availableExpectedAt: delayedAt,
        availableUpperAt: delayedAt,
      });
    const first = createDispatchPlan({
      now: NOW,
      groups,
      lanes: [lane("aircraft-a", 3), delayedLane("aircraft-b")],
      limits: { maximumWaves: 1 },
    });
    const replanned = createDispatchPlan({
      now: NOW,
      groups,
      lanes: [delayedLane("aircraft-a"), lane("aircraft-b", 3)],
      previousPlan: first,
      limits: { maximumWaves: 1 },
    });

    expect(first.batches[0]?.memberIds).toEqual(["first", "pair"]);
    expect(replanned.batches[0]).toMatchObject({
      id: first.batches[0]?.id,
      memberIds: ["first", "pair"],
      laneId: "aircraft-b",
      assumedAircraftId: "aircraft-aircraft-b",
    });
  });

  it("uses added capacity globally without delaying an already called group", () => {
    const groups = [
      group("first-single", 1, 1, { publicStatus: "COME_TO_FLIGHT_LINE" }),
      group("first-pair", 2, 2, { publicStatus: "COME_TO_FLIGHT_LINE" }),
      group("second-single", 1, 3, { publicStatus: "COME_TO_FLIGHT_LINE" }),
      group("second-pair", 2, 4, { publicStatus: "COME_TO_FLIGHT_LINE" }),
      group("third-single", 1, 5, { publicStatus: "COME_TO_FLIGHT_LINE" }),
    ];
    const first = createDispatchPlan({
      now: NOW,
      groups,
      lanes: [lane("three-a", 3), lane("three-b", 3)],
      limits: { maximumWaves: 1 },
    });
    const replanned = createDispatchPlan({
      now: NOW,
      groups,
      lanes: [lane("four", 4), lane("three-b", 3)],
      previousPlan: first,
      limits: { maximumWaves: 1 },
    });
    expect(first.batches.reduce((sum, batch) => sum + batch.occupiedSeats, 0)).toBe(6);
    expect(replanned.batches.reduce((sum, batch) => sum + batch.occupiedSeats, 0)).toBe(7);
    expect(replanned.groupDecisions).toHaveLength(5);
    expect(
      first.groupDecisions.every((oldDecision) => {
        const decision = replanned.groupDecisions.find(
          (candidate) => candidate.memberId === oldDecision.memberId,
        );
        const oldBatch = first.batches.find((batch) => batch.id === oldDecision.batchId);
        const batch = replanned.batches.find((candidate) => candidate.id === decision?.batchId);
        return (
          oldBatch !== undefined &&
          batch !== undefined &&
          Date.parse(batch.boardingWindowExpectedAt) <=
            Date.parse(oldBatch.boardingWindowExpectedAt)
        );
      }),
    ).toBe(true);
  });

  it("freezes an active lease and plans only remaining groups and aircraft capacity", () => {
    const groups = [group("leased-single", 1, 1), group("leased-pair", 2, 2), group("next", 3, 3)];
    const plan = createDispatchPlan({
      now: NOW,
      groups,
      lanes: [lane("reserved", 3), lane("free", 3)],
      lockedBatches: [
        {
          id: "dispatch-batch-active-lease",
          resourceGroupId: "touring",
          productId: "short-flight",
          gateId: "gate-a",
          aircraftId: "aircraft-reserved",
          memberIds: ["leased-single", "leased-pair"],
        },
      ],
      limits: { maximumWaves: 1 },
    });

    expect(plan.batches.find((batch) => batch.id === "dispatch-batch-active-lease")).toMatchObject({
      laneId: "reserved",
      memberIds: ["leased-single", "leased-pair"],
      occupiedSeats: 3,
    });
    expect(plan.batches.find((batch) => batch.memberIds.includes("next"))).toMatchObject({
      laneId: "free",
      occupiedSeats: 3,
    });
    expect(new Set(plan.batches.flatMap((batch) => batch.memberIds)).size).toBe(3);
  });

  it.each([
    {
      name: "missing aircraft lane",
      groups: [group("a", 1, 1)],
      lanes: [lane("available", 3)],
      lockedBatches: [
        {
          id: "lease-1",
          resourceGroupId: "touring",
          productId: "short-flight",
          gateId: "gate-a",
          aircraftId: "aircraft-missing",
          memberIds: ["a"],
        },
      ],
      message: /no available aircraft lane/,
    },
    {
      name: "empty member list",
      groups: [group("a", 1, 1)],
      lanes: [lane("available", 3)],
      lockedBatches: [
        {
          id: "lease-1",
          resourceGroupId: "touring",
          productId: "short-flight",
          gateId: "gate-a",
          aircraftId: "aircraft-available",
          memberIds: [],
        },
      ],
      message: /invalid members/,
    },
    {
      name: "unknown member",
      groups: [group("a", 1, 1)],
      lanes: [lane("available", 3)],
      lockedBatches: [
        {
          id: "lease-1",
          resourceGroupId: "touring",
          productId: "short-flight",
          gateId: "gate-a",
          aircraftId: "aircraft-available",
          memberIds: ["missing"],
        },
      ],
      message: /references unavailable members/,
    },
    {
      name: "incompatible product",
      groups: [group("a", 1, 1)],
      lanes: [lane("available", 3)],
      lockedBatches: [
        {
          id: "lease-1",
          resourceGroupId: "touring",
          productId: "long-flight",
          gateId: "gate-a",
          aircraftId: "aircraft-available",
          memberIds: ["a"],
        },
      ],
      message: /incompatible with its members/,
    },
    {
      name: "insufficient seats",
      groups: [group("a", 3, 1)],
      lanes: [lane("available", 2)],
      lockedBatches: [
        {
          id: "lease-1",
          resourceGroupId: "touring",
          productId: "short-flight",
          gateId: "gate-a",
          aircraftId: "aircraft-available",
          memberIds: ["a"],
        },
      ],
      message: /no longer fits its aircraft/,
    },
  ])("rejects a locked batch with $name", ({ groups, lanes, lockedBatches, message }) => {
    expect(() =>
      createDispatchPlan({ now: NOW, groups, lanes, lockedBatches, limits: { maximumWaves: 1 } }),
    ).toThrow(message);
  });

  it("rejects duplicate lease identities and cross-lease member ownership", () => {
    const lockedBatch = {
      id: "lease-1",
      resourceGroupId: "touring",
      productId: "short-flight",
      gateId: "gate-a",
      aircraftId: "aircraft-a",
      memberIds: ["a"],
    };
    const input = {
      now: NOW,
      groups: [group("a", 1, 1), group("b", 1, 2)],
      lanes: [lane("a", 3), lane("b", 3)],
      limits: { maximumWaves: 1 },
    };
    expect(() =>
      createDispatchPlan({ ...input, lockedBatches: [lockedBatch, { ...lockedBatch }] }),
    ).toThrow(/is duplicated/);
    expect(() =>
      createDispatchPlan({
        ...input,
        lockedBatches: [lockedBatch, { ...lockedBatch, id: "lease-2", aircraftId: "aircraft-b" }],
      }),
    ).toThrow(/held by multiple active leases/);
    expect(() =>
      createDispatchPlan({
        ...input,
        lockedBatches: [lockedBatch, { ...lockedBatch, id: "lease-2", memberIds: ["b"] }],
      }),
    ).toThrow(/multiple active leases/);
  });

  it("rejects predecessors outside the same resource group", () => {
    expect(() =>
      createDispatchPlan({
        now: NOW,
        groups: [
          group("first", 1, 1, { resourceGroupId: "other" }),
          group("second", 1, 2, { predecessorMemberIds: ["first"] }),
        ],
        lanes: [lane("available", 3)],
      }),
    ).toThrow(/invalid predecessor/);
  });

  it("replans after a lane loss without duplicating or splitting groups", () => {
    const groups = [group("a", 2, 1), group("b", 1, 2), group("c", 3, 3)];
    const first = createDispatchPlan({
      now: NOW,
      groups,
      lanes: [lane("lane-a", 3), lane("lane-b", 3)],
      limits: { maximumWaves: 1 },
    });
    const replanned = createDispatchPlan({
      now: NOW,
      groups,
      lanes: [lane("lane-b", 3)],
      previousPlan: first,
      limits: { maximumWaves: 2 },
    });

    const assigned = replanned.batches.flatMap((batch) => batch.memberIds);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(assigned.sort()).toEqual(["a", "b", "c"]);
    expect(replanned.batches.every((batch) => batch.occupiedSeats <= 3)).toBe(true);
  });

  it("dispatches split booking-group segments in order and never combines them", () => {
    const plan = createDispatchPlan({
      now: NOW,
      groups: [
        group("split-part-1", 3, 1, { groupIds: ["booking-split"] }),
        group("split-part-2", 1, 1, {
          groupIds: ["booking-split"],
          predecessorMemberIds: ["split-part-1"],
        }),
        group("single-a", 1, 2),
        group("single-b", 1, 3),
      ],
      lanes: [lane("three-seat", 3)],
      limits: { maximumWaves: 3 },
    });

    const firstPartBatch = plan.batches.find((batch) => batch.memberIds.includes("split-part-1"));
    const secondPartBatch = plan.batches.find((batch) => batch.memberIds.includes("split-part-2"));

    expect(firstPartBatch?.occupiedSeats).toBe(3);
    expect(secondPartBatch?.dispatchOrder).toBeGreaterThan(firstPartBatch?.dispatchOrder ?? 0);
    expect(
      plan.batches.every((batch) => new Set(batch.groupIds).size === batch.groupIds.length),
    ).toBe(true);
    expect(plan.batches.every((batch) => batch.occupiedSeats <= 3)).toBe(true);
  });

  it("is deterministic, product-pure and does not mutate queue input", () => {
    const groups = [
      group("a", 1, 1),
      group("b", 1, 2),
      group("long", 1, 3, { productId: "long-flight" }),
    ];
    const snapshot = structuredClone(groups);
    const input = { now: NOW, groups, lanes: [lane("lane-a", 3)], limits: { maximumWaves: 2 } };
    const first = createDispatchPlan(input);
    const second = createDispatchPlan(input);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.objective).toMatchObject({
      transportedPassengers: expect.any(Number),
      projectedOvertakes: expect.any(Number),
      retainedPreviousPlanMembers: expect.any(Number),
    });
    expect(first.searchDiagnostics).toMatchObject({
      consideredGroups: 3,
      expandedStates: expect.any(Number),
      candidateLimitReached: expect.any(Boolean),
      beamLimitReached: expect.any(Boolean),
    });
    expect(groups).toEqual(snapshot);
    expect(
      first.batches.every((batch) => {
        const products = batch.memberIds.map(
          (memberId) => groups.find((entry) => entry.id === memberId)?.productId,
        );
        return new Set(products).size === 1;
      }),
    ).toBe(true);
  });

  it("reports candidate and beam truncation without changing deterministic output", () => {
    const input = {
      now: NOW,
      groups: Array.from({ length: 10 }, (_, index) => group(`bounded-${index + 1}`, 1, index + 1)),
      lanes: [lane("bounded-lane", 4)],
      limits: {
        maximumCandidatesPerStep: 2,
        beamWidth: 1,
        maximumWaves: 2,
      },
    };
    const first = createDispatchPlan(input);
    const second = createDispatchPlan(input);

    expect(first.searchDiagnostics).toMatchObject({
      candidateLimitReached: true,
      beamLimitReached: true,
    });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("keeps each product-pure batch on one gate", () => {
    const groups = [
      group("gate-a-1", 1, 1),
      group("gate-b-1", 1, 2, { gateId: "gate-b" }),
      group("gate-a-2", 1, 3),
      group("gate-b-2", 1, 4, { gateId: "gate-b" }),
    ];
    const plan = createDispatchPlan({
      now: NOW,
      groups,
      lanes: [lane("lane-a", 3)],
      limits: { maximumWaves: 2 },
    });

    expect(plan.batches).toHaveLength(2);
    expect(
      plan.batches.every((batch) => {
        const gates = batch.memberIds.map(
          (memberId) => groups.find((entry) => entry.id === memberId)?.gateId,
        );
        return new Set(gates).size === 1 && gates[0] === batch.gateId;
      }),
    ).toBe(true);
  });

  it("returns no artificial zero-minute plan when forecast capacity is absent", () => {
    const plan = createDispatchPlan({ now: NOW, groups: [group("a", 1, 1)], lanes: [] });
    expect(plan.batches).toEqual([]);
    expect(plan.unplannedGroups).toEqual([{ memberId: "a", reason: "NO_FORECAST_CAPACITY" }]);
  });
});
