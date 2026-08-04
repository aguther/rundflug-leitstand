import { describe, expect, it } from "vitest";

import { runSimulation, sampleTriangular } from "./engine";
import {
  calculateDemandSummary,
  demandForProfile,
  type SimulationConfig,
  salesDurationMinutes,
  simulationConfigForPreset,
  validateSimulationConfig,
} from "./model";

const FORECAST_BASELINE_TIMEOUT_MS = 60_000;

function shortNormalConfig() {
  const config = simulationConfigForPreset("NORMAL");
  config.schedule.salesEndAt = "2026-07-22T10:00:00.000Z";
  config.schedule.operationsEndAt = "2026-07-22T11:00:00.000Z";
  config.realityModel.demand = demandForProfile("TWO_WAVES", 180);
  return config;
}

function operationalConfig(): SimulationConfig {
  const config = simulationConfigForPreset("NORMAL");
  config.schedule = {
    timeZone: "Europe/Berlin",
    salesStartAt: "2026-07-22T07:00:00.000Z",
    salesEndAt: "2026-07-22T10:30:00.000Z",
    operationsStartAt: "2026-07-22T08:00:00.000Z",
    operationsEndAt: "2026-07-22T11:00:00.000Z",
  };
  config.adminParameters.aircraftCount = 2;
  config.adminParameters.activePilotCount = 2;
  config.realityModel.demand = demandForProfile("UNIFORM", 210, 12);
  config.realityModel.incidents.refueling.enabled = false;
  config.realityModel.incidents.plannedPause.enabled = false;
  config.realityModel.incidents.unplannedPause.enabled = false;
  config.realityModel.incidents.technicalDefect.enabled = false;
  config.operationalModel = {
    sourceName: "Importierter Flugtag",
    gates: [
      { id: "gate-a", label: "Flight Line A" },
      { id: "gate-b", label: "Flight Line B" },
    ],
    resourceGroups: [
      {
        id: "group-a",
        name: "Gruppe A",
        shortCode: "GA",
        gateId: "gate-a",
        automaticPrecallEnabled: true,
      },
      {
        id: "group-b",
        name: "Gruppe B",
        shortCode: "GB",
        gateId: "gate-b",
        automaticPrecallEnabled: true,
      },
    ],
    aircraft: [
      {
        id: "aircraft-a",
        registration: "D-EAAA",
        aircraftType: "C172",
        capacity: 3,
        resourceGroupId: "group-a",
      },
      {
        id: "aircraft-b",
        registration: "D-EBBB",
        aircraftType: "PA28",
        capacity: 3,
        resourceGroupId: "group-b",
      },
    ],
    pilots: [
      { id: "pilot-a", operationalCode: "PA", active: true },
      { id: "pilot-b", operationalCode: "PB", active: true },
    ],
    products: [
      {
        id: "product-a",
        name: "Rundflug A",
        code: "RFA",
        resourceGroupId: "group-a",
        gateId: "gate-a",
        referenceCapacity: 3,
        referenceDurationMinutes: 20,
      },
      {
        id: "product-b",
        name: "Rundflug B",
        code: "RFB",
        resourceGroupId: "group-b",
        gateId: "gate-b",
        referenceCapacity: 3,
        referenceDurationMinutes: 25,
      },
    ],
  };
  config.demandByProduct = {
    "product-a": demandForProfile("UNIFORM", 210, 12),
    "product-b": demandForProfile("UNIFORM", 210, 12),
  };
  config.plannedOperations = [
    {
      key: "plan-event",
      scopeType: "EVENT",
      scopeId: "event",
      kind: "FLIGHT_SHOW",
      startMode: "TIME_WINDOW",
      earliestStartAt: "2026-07-22T09:00:00.000Z",
      latestStartAt: "2026-07-22T09:05:00.000Z",
      afterRotationId: null,
      unresolvedAfterCurrentRotation: false,
      minimumDurationMinutes: 15,
      typicalDurationMinutes: 15,
      maximumDurationMinutes: 15,
      publicNote: "Flugshow läuft",
    },
    {
      key: "plan-group",
      scopeType: "RESOURCE_GROUP",
      scopeId: "group-a",
      kind: "PAUSE",
      startMode: "TIME_WINDOW",
      earliestStartAt: "2026-07-22T09:30:00.000Z",
      latestStartAt: "2026-07-22T09:35:00.000Z",
      afterRotationId: null,
      unresolvedAfterCurrentRotation: false,
      minimumDurationMinutes: 10,
      typicalDurationMinutes: 10,
      maximumDurationMinutes: 10,
      publicNote: "Gruppe A pausiert",
    },
    {
      key: "plan-aircraft",
      scopeType: "AIRCRAFT",
      scopeId: "aircraft-b",
      kind: "REFUELING",
      startMode: "TIME_WINDOW",
      earliestStartAt: "2026-07-22T08:30:00.000Z",
      latestStartAt: "2026-07-22T08:35:00.000Z",
      afterRotationId: null,
      unresolvedAfterCurrentRotation: false,
      minimumDurationMinutes: 8,
      typicalDurationMinutes: 8,
      maximumDurationMinutes: 8,
      publicNote: "",
    },
    {
      key: "plan-pilot",
      scopeType: "PILOT",
      scopeId: "pilot-a",
      kind: "PAUSE",
      startMode: "TIME_WINDOW",
      earliestStartAt: "2026-07-22T10:00:00.000Z",
      latestStartAt: "2026-07-22T10:05:00.000Z",
      afterRotationId: null,
      unresolvedAfterCurrentRotation: false,
      minimumDurationMinutes: 8,
      typicalDurationMinutes: 8,
      maximumDurationMinutes: 8,
      publicNote: "",
    },
  ];
  return config;
}

describe("local forecast simulation", () => {
  it("plays imported topology and all planned-operation scopes deterministically", () => {
    const config = operationalConfig();
    expect(validateSimulationConfig(config)).toEqual([]);

    const first = runSimulation(config);
    const second = runSimulation(structuredClone(config));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(new Set(first.rotations.map((entry) => entry.productCode))).toEqual(
      new Set(["RFA", "RFB"]),
    );
    expect(
      first.rotations
        .filter((entry) => entry.aircraftId)
        .every((entry) => {
          const aircraft = first.aircraft.find((candidate) => candidate.id === entry.aircraftId);
          return aircraft?.resourceGroupId === entry.resourceGroupId;
        }),
    ).toBe(true);
    expect(
      new Set(
        first.events
          .filter((entry) => entry.type === "PLANNED_OPERATION_STARTED")
          .map((entry) => entry.plannedOperationId),
      ),
    ).toEqual(new Set(["plan-event", "plan-group", "plan-aircraft", "plan-pilot"]));
    const eventStart = first.events.find(
      (entry) =>
        entry.type === "PLANNED_OPERATION_STARTED" && entry.plannedOperationId === "plan-event",
    );
    const eventEnd = first.events.find(
      (entry) =>
        entry.type === "PLANNED_OPERATION_ENDED" && entry.plannedOperationId === "plan-event",
    );
    expect(eventStart).toBeDefined();
    expect(eventEnd).toBeDefined();
    expect(
      first.events
        .filter((entry) => entry.type === "ROTATION_CALLED")
        .some(
          (entry) =>
            Date.parse(entry.occurredAt) >= Date.parse(eventStart?.occurredAt ?? "") &&
            Date.parse(entry.occurredAt) < Date.parse(eventEnd?.occurredAt ?? ""),
        ),
    ).toBe(false);
  });

  it("creates arrivals exclusively from each product demand profile", () => {
    const config = operationalConfig();
    config.plannedOperations = [];
    config.demandByProduct = {
      "product-a": {
        profile: "CUSTOM",
        windows: [{ startOffsetMinutes: 0, endOffsetMinutes: 210, personsPerHour: 0 }],
      },
      "product-b": demandForProfile("UNIFORM", 210, 30),
    };

    const result = runSimulation(config);
    expect(result.rotations.length).toBeGreaterThan(0);
    expect(new Set(result.rotations.map((rotation) => rotation.productId))).toEqual(
      new Set(["product-b"]),
    );
    expect(result.rotations.every((rotation) => rotation.resourceGroupId === "group-b")).toBe(true);
  });

  it("serves mixed products in one queue with bounded, visible overtakes", () => {
    const config = operationalConfig();
    config.plannedOperations = [];
    const secondProduct = config.operationalModel?.products.find(
      (product) => product.id === "product-b",
    );
    const secondAircraft = config.operationalModel?.aircraft.find(
      (aircraft) => aircraft.id === "aircraft-b",
    );
    if (!secondProduct || !secondAircraft)
      throw new Error("Operative Testdaten sind unvollständig.");
    secondProduct.resourceGroupId = "group-a";
    secondProduct.gateId = "gate-a";
    secondAircraft.resourceGroupId = "group-a";

    const result = runSimulation(config);
    const arrived = [...result.rotations]
      .filter((rotation) => rotation.calledAt)
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.communicationNumber - right.communicationNumber,
      );
    const called = [...arrived].sort(
      (left, right) =>
        Date.parse(left.calledAt ?? "") - Date.parse(right.calledAt ?? "") ||
        left.communicationNumber - right.communicationNumber,
    );

    expect(new Set(arrived.map((rotation) => rotation.productId))).toEqual(
      new Set(["product-a", "product-b"]),
    );
    expect(arrived.every((rotation) => rotation.resourceGroupId === "group-a")).toBe(true);
    expect(called.map((rotation) => rotation.id)).not.toEqual(
      arrived.map((rotation) => rotation.id),
    );
    expect(called.every((rotation) => (rotation.dispatchMaximumOvertakeCount ?? 0) <= 3)).toBe(
      true,
    );
    expect(Object.keys(result.metrics.dispatch.serviceSharePercentByProduct).sort()).toEqual([
      "product-a",
      "product-b",
    ]);
  });

  it("starts a resolved plan only after its selected synthetic rotation completes", () => {
    const config = operationalConfig();
    config.plannedOperations = [
      {
        key: "plan-after-rotation",
        scopeType: "EVENT",
        scopeId: "event",
        kind: "PAUSE",
        startMode: "AFTER_CURRENT_ROTATION",
        earliestStartAt: null,
        latestStartAt: null,
        afterRotationId: "rotation-001",
        unresolvedAfterCurrentRotation: false,
        minimumDurationMinutes: 5,
        typicalDurationMinutes: 5,
        maximumDurationMinutes: 5,
        publicNote: "",
      },
    ];

    const result = runSimulation(config);
    const reference = result.rotations.find((entry) => entry.id === "rotation-001");
    const start = result.events.find(
      (entry) =>
        entry.type === "PLANNED_OPERATION_STARTED" &&
        entry.plannedOperationId === "plan-after-rotation",
    );

    expect(reference?.completedAt).not.toBeNull();
    expect(start).toBeDefined();
    expect(Date.parse(start?.occurredAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse(reference?.completedAt ?? ""),
    );
  });

  it("applies imported recurring aircraft and pilot rules deterministically without generic duplicates", () => {
    const config = operationalConfig();
    config.plannedOperations = [];
    config.realityModel.incidents.refueling.enabled = true;
    config.realityModel.incidents.refueling.everyRotations = 1;
    config.realityModel.incidents.plannedPause.enabled = true;
    config.realityModel.incidents.plannedPause.everyOperatingMinutes = 1;
    config.recurringRules = [
      {
        key: "rule-aircraft-refuel",
        scopeType: "AIRCRAFT",
        scopeId: "aircraft-a",
        kind: "REFUELING",
        triggerMetric: "COMPLETED_ROTATIONS",
        intervalValue: 1,
        progressValue: 0,
        minimumDurationMinutes: 5,
        typicalDurationMinutes: 5,
        maximumDurationMinutes: 5,
      },
      {
        key: "rule-pilot-pause",
        scopeType: "PILOT",
        scopeId: "pilot-a",
        kind: "PAUSE",
        triggerMetric: "COMPLETED_ROTATIONS",
        intervalValue: 1,
        progressValue: 0,
        minimumDurationMinutes: 10,
        typicalDurationMinutes: 10,
        maximumDurationMinutes: 10,
      },
      {
        key: "rule-aircraft-pause",
        scopeType: "AIRCRAFT",
        scopeId: "aircraft-a",
        kind: "PAUSE",
        triggerMetric: "OPERATING_MINUTES",
        intervalValue: 30,
        progressValue: 0,
        minimumDurationMinutes: 6,
        typicalDurationMinutes: 8,
        maximumDurationMinutes: 10,
      },
    ];

    const first = runSimulation(config);
    const second = runSimulation(structuredClone(config));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const recurringStarts = first.events.filter(
      (event) =>
        event.type === "PLANNED_OPERATION_STARTED" &&
        (event.plannedOperationId?.startsWith("rule-aircraft-refuel:") ||
          event.plannedOperationId?.startsWith("rule-pilot-pause:")),
    );
    expect(recurringStarts.length).toBeGreaterThanOrEqual(2);
    expect(
      first.plannedOperations?.some((plan) => plan.key.startsWith("rule-aircraft-refuel:")),
    ).toBe(true);
    expect(
      first.events.some(
        (event) => event.type === "REFUELING_STARTED" && event.aircraftId === "aircraft-a",
      ),
    ).toBe(false);
    expect(
      first.events.some(
        (event) => event.type === "REFUELING_STARTED" && event.aircraftId === "aircraft-b",
      ),
    ).toBe(true);
    expect(
      first.events.some(
        (event) => event.type === "PLANNED_PAUSE_STARTED" && event.aircraftId === "aircraft-a",
      ),
    ).toBe(false);
    expect(
      first.events.some(
        (event) => event.type === "PLANNED_PAUSE_STARTED" && event.aircraftId === "aircraft-b",
      ),
    ).toBe(true);
  });

  it(
    "captures the approved preset baseline",
    () => {
      const baseline = Object.fromEntries(
        (["NORMAL", "PEAK_LOAD", "AIRCRAFT_FAILURE", "OPERATION_INTERRUPTION"] as const).map(
          (preset) => {
            const result = runSimulation(simulationConfigForPreset(preset));
            return [
              preset,
              {
                generated: result.rotations.length,
                completed: result.rotations.filter((rotation) => rotation.completedAt).length,
                windowCoverage: result.metrics.boarding.windowCoveragePercent,
                boardingMedian: result.metrics.boarding.medianAbsoluteErrorMinutes,
                boardingP90: result.metrics.boarding.p90AbsoluteErrorMinutes,
                averageWindowWidth: result.metrics.boarding.averageWindowWidthMinutes,
                maximumReactionSeconds: result.metrics.maximumEventReactionSeconds,
                uncertainCountdownViolations: result.metrics.uncertainCountdownViolations,
                precall: result.metrics.precall,
              },
            ];
          },
        ),
      );
      expect(baseline).toEqual({
        NORMAL: {
          generated: 40,
          completed: 28,
          windowCoverage: 82.14,
          boardingMedian: 2,
          boardingP90: 14.5,
          averageWindowWidth: 4.79,
          maximumReactionSeconds: 29.648,
          uncertainCountdownViolations: 0,
          precall: {
            eligibleGroups: 28,
            precalledGroups: 27,
            coveragePercent: 96.43,
            medianGateWaitMinutes: 23.5,
            p90GateWaitMinutes: 45.9,
            sameTickCount: 3,
            uncertainPrecallCount: 0,
          },
        },
        PEAK_LOAD: {
          generated: 78,
          completed: 28,
          windowCoverage: 82.14,
          boardingMedian: 2,
          boardingP90: 14.5,
          averageWindowWidth: 4.79,
          maximumReactionSeconds: 29.648,
          uncertainCountdownViolations: 0,
          precall: {
            eligibleGroups: 28,
            precalledGroups: 27,
            coveragePercent: 96.43,
            medianGateWaitMinutes: 23.5,
            p90GateWaitMinutes: 45.9,
            sameTickCount: 3,
            uncertainPrecallCount: 0,
          },
        },
        AIRCRAFT_FAILURE: {
          generated: 40,
          completed: 21,
          windowCoverage: 90.48,
          boardingMedian: 2,
          boardingP90: 2.5,
          averageWindowWidth: 4.67,
          maximumReactionSeconds: 29.648,
          uncertainCountdownViolations: 0,
          precall: {
            eligibleGroups: 21,
            precalledGroups: 21,
            coveragePercent: 100,
            medianGateWaitMinutes: 25.5,
            p90GateWaitMinutes: 51,
            sameTickCount: 3,
            uncertainPrecallCount: 0,
          },
        },
        OPERATION_INTERRUPTION: {
          generated: 40,
          completed: 27,
          windowCoverage: 74.07,
          boardingMedian: 2,
          boardingP90: 14.5,
          averageWindowWidth: 5.07,
          maximumReactionSeconds: 29.648,
          uncertainCountdownViolations: 0,
          precall: {
            eligibleGroups: 27,
            precalledGroups: 27,
            coveragePercent: 100,
            medianGateWaitMinutes: 24,
            p90GateWaitMinutes: 43.3,
            sameTickCount: 3,
            uncertainPrecallCount: 0,
          },
        },
      });
    },
    FORECAST_BASELINE_TIMEOUT_MS,
  );

  it("is bit-for-bit reproducible for the same parameters and seed", () => {
    const config = shortNormalConfig();
    const first = runSimulation(config);
    const second = runSimulation(structuredClone(config));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.rotations.length).toBeGreaterThan(0);
    expect(first.snapshots.length).toBeGreaterThan(0);
    expect(first.metrics.dispatch.goToGateReplans).toBe(0);
    expect(first.metrics.dispatch.prepareDemotions).toBe(0);
    expect(first.metrics.dispatch.occupiedSeats).toBeGreaterThan(0);
    expect(first.metrics.dispatch.offeredSeats).toBeGreaterThanOrEqual(
      first.metrics.dispatch.occupiedSeats,
    );
  });

  it("builds a conservatively forecast opening queue without precalling before operations start", () => {
    const config = simulationConfigForPreset("NORMAL");
    const result = runSimulation(config);
    const operationsStart = Date.parse(config.schedule.operationsStartAt);
    const openingQueue = result.rotations.filter(
      (rotation) => Date.parse(rotation.createdAt) < operationsStart,
    );

    expect(openingQueue.length).toBeGreaterThan(0);
    expect(
      result.events
        .filter(
          (event) => event.type === "FLIGHT_GROUP_PRECALLED" || event.type === "ROTATION_CALLED",
        )
        .every((event) => Date.parse(event.occurredAt) >= operationsStart),
    ).toBe(true);
    const openingSnapshots = result.snapshots.filter(
      (snapshot) => Date.parse(snapshot.capturedAt) < operationsStart,
    );
    expect(openingSnapshots.length).toBeGreaterThan(0);
    expect(
      openingSnapshots.every(
        (snapshot) =>
          snapshot.activeCapacity > 0 &&
          ["DISPATCH_WINDOW", "LONG_RANGE_WINDOW"].includes(snapshot.forecastState ?? "") &&
          !snapshot.uncertaintyReasons.includes("RESOURCE_GROUP_INACTIVE") &&
          !snapshot.uncertaintyReasons.includes("OPERATION_INTERRUPTED") &&
          Date.parse(snapshot.predictedBoardingAt) >= operationsStart,
      ),
    ).toBe(true);
  });

  it("stops new rotations at operations end and completes already active rotations", () => {
    const config = simulationConfigForPreset("NORMAL");
    config.schedule.salesStartAt = "2026-07-22T07:59:00.000Z";
    config.schedule.salesEndAt = "2026-07-22T08:00:00.000Z";
    config.schedule.operationsStartAt = "2026-07-22T08:00:00.000Z";
    config.schedule.operationsEndAt = "2026-07-22T08:01:00.000Z";
    config.realityModel.demand = demandForProfile("UNIFORM", 1, 72_000);
    config.realityModel.incidents.refueling.enabled = false;
    config.realityModel.incidents.plannedPause.enabled = false;
    config.realityModel.incidents.unplannedPause.enabled = false;
    config.realityModel.incidents.technicalDefect.enabled = false;
    const result = runSimulation(config);
    const operationsEnd = Date.parse(config.schedule.operationsEndAt);
    const called = result.rotations.filter((rotation) => rotation.calledAt);

    expect(called).toHaveLength(3);
    expect(called.every((rotation) => Date.parse(rotation.calledAt ?? "") < operationsEnd)).toBe(
      true,
    );
    expect(called.every((rotation) => rotation.completedAt !== null)).toBe(true);
    expect(Date.parse(result.runWindow.endAt)).toBeGreaterThan(operationsEnd);
  });

  it("creates no sales inside explicit zero-demand gaps", () => {
    const config = shortNormalConfig();
    config.realityModel.demand = {
      profile: "CUSTOM",
      windows: [
        { startOffsetMinutes: 0, endOffsetMinutes: 30, personsPerHour: 240 },
        { startOffsetMinutes: 90, endOffsetMinutes: 120, personsPerHour: 240 },
      ],
    };
    const result = runSimulation(config);
    const salesStart = Date.parse(config.schedule.salesStartAt);
    const gapStart = salesStart + 30 * 60_000;
    const gapEnd = salesStart + 90 * 60_000;

    expect(result.rotations.length).toBeGreaterThan(0);
    expect(
      result.rotations.every((rotation) => {
        const createdAt = Date.parse(rotation.createdAt);
        return createdAt < gapStart || createdAt >= gapEnd;
      }),
    ).toBe(true);
  });

  it("keeps a fully demand-free profile empty", () => {
    const config = shortNormalConfig();
    config.realityModel.demand = { profile: "CUSTOM", windows: [] };
    const result = runSimulation(config);

    expect(result.rotations).toEqual([]);
    expect(result.snapshots).toEqual([]);
    expect(result.runWindow.endAt).toBe(config.schedule.operationsEndAt);
  });

  it("separates Admin plan values from the simulated real duration", () => {
    const baselineConfig = shortNormalConfig();
    const changedPlan = structuredClone(baselineConfig);
    changedPlan.adminParameters.productReferenceDurationMinutes = 35;
    const baseline = runSimulation(baselineConfig);
    const candidate = runSimulation(changedPlan);

    expect(candidate.rotations[0]?.flightMinutes).toBe(baseline.rotations[0]?.flightMinutes);
    expect(candidate.snapshots[0]?.predictedLandingAt).not.toBe(
      baseline.snapshots[0]?.predictedLandingAt,
    );
  });

  it("uses pilots, seats and aircraft type from the effective Admin profile", () => {
    const config = shortNormalConfig();
    config.adminParameters.activePilotCount = 1;
    config.adminParameters.passengerSeats = 3;
    config.adminParameters.aircraftType = "SYN-TUNING";
    const result = runSimulation(config);

    expect(result.aircraft).toHaveLength(3);
    expect(result.aircraft.every((aircraft) => aircraft.capacity === 3)).toBe(true);
    expect(result.aircraft.every((aircraft) => aircraft.aircraftType === "SYN-TUNING")).toBe(true);
    expect(result.rotations.every((rotation) => rotation.passengerCount === 3)).toBe(true);
    expect(result.snapshots.every((snapshot) => snapshot.activeCapacity <= 1)).toBe(true);
  });

  it("uses the triangular inverse distribution at its exact boundaries and mode", () => {
    const distribution = { minimum: 4, typical: 7, maximum: 12 };
    expect(sampleTriangular(distribution, 0)).toBe(4);
    expect(sampleTriangular(distribution, (7 - 4) / (12 - 4))).toBe(7);
    expect(sampleTriangular(distribution, 1)).toBeCloseTo(12, 6);
  });

  it("keeps the queue group intact and never overlaps rotations on one aircraft", () => {
    const result = runSimulation(shortNormalConfig());
    expect(result.rotations.every((rotation) => rotation.passengerCount === 4)).toBe(true);
    for (const aircraft of result.aircraft) {
      const assigned = result.rotations
        .filter(
          (rotation) =>
            rotation.aircraftId === aircraft.id && rotation.calledAt && rotation.completedAt,
        )
        .sort((left, right) => Date.parse(left.calledAt ?? "") - Date.parse(right.calledAt ?? ""));
      for (let index = 1; index < assigned.length; index += 1) {
        expect(Date.parse(assigned[index]?.calledAt ?? "")).toBeGreaterThanOrEqual(
          Date.parse(assigned[index - 1]?.completedAt ?? ""),
        );
      }
    }
  });

  it("records chronological events and recalculates within 30 seconds", () => {
    const result = runSimulation(shortNormalConfig());
    const timestamps = result.events.map((event) => Date.parse(event.occurredAt));
    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right));
    expect(result.metrics.maximumEventReactionSeconds).toBeLessThanOrEqual(30);
    expect(result.metrics.uncertainCountdownViolations).toBe(0);
  });

  it("records automatic GO TO GATE before boarding without an aircraft binding", () => {
    const result = runSimulation(shortNormalConfig());
    const precalls = result.events.filter((event) => event.type === "FLIGHT_GROUP_PRECALLED");

    expect(precalls.length).toBeGreaterThan(0);
    for (const precall of precalls) {
      expect(precall.aircraftId).toBeNull();
      const rotation = result.rotations.find((entry) => entry.id === precall.rotationId);
      expect(rotation).toMatchObject({
        precalledAt: precall.occurredAt,
        precallTrigger: "AUTOMATIC_PRECALL",
      });
      expect(rotation?.precallPredictionQuality).not.toBeNull();
      expect(Date.parse(rotation?.precallPredictedBoardingAt ?? "")).not.toBeNaN();
      expect(rotation?.precallAdaptiveLeadMinutes).toBeGreaterThanOrEqual(6);
      expect(rotation?.precallAdaptiveLeadMinutes).toBeLessThanOrEqual(18);
      expect(rotation?.aircraftId).not.toBeNull();
      expect(Date.parse(rotation?.calledAt ?? "")).toBeGreaterThanOrEqual(
        Date.parse(precall.occurredAt),
      );
      const sameTickEvents = result.events.filter(
        (event) => event.rotationId === rotation?.id && event.occurredAt === precall.occurredAt,
      );
      const sameTickTypes = sameTickEvents.map((event) => event.type);
      if (sameTickTypes.includes("ROTATION_CALLED")) {
        expect(sameTickTypes.indexOf("FLIGHT_GROUP_PRECALLED")).toBeLessThan(
          sameTickTypes.indexOf("ROTATION_CALLED"),
        );
      }
    }
    expect(result.metrics.precall.precalledGroups).toBe(
      result.rotations.filter((rotation) => rotation.precalledAt && rotation.calledAt).length,
    );
    expect(result.metrics.precall.coveragePercent).not.toBeNull();
  });

  it("records queue-sorted parallel GO TO GATE events in the same forecast tick", () => {
    const config = simulationConfigForPreset("NORMAL");
    config.schedule.salesStartAt = "2026-07-22T07:59:00.000Z";
    config.schedule.salesEndAt = "2026-07-22T08:00:00.000Z";
    config.schedule.operationsStartAt = "2026-07-22T08:00:00.000Z";
    config.schedule.operationsEndAt = "2026-07-22T08:01:00.000Z";
    config.realityModel.demand = demandForProfile("UNIFORM", 1, 72_000);
    config.realityModel.incidents.refueling.enabled = false;
    config.realityModel.incidents.plannedPause.enabled = false;
    config.realityModel.incidents.unplannedPause.enabled = false;
    config.realityModel.incidents.technicalDefect.enabled = false;
    const result = runSimulation(config);
    const precallsByTick = new Map<string, typeof result.events>();
    for (const event of result.events.filter(
      (candidate) => candidate.type === "FLIGHT_GROUP_PRECALLED",
    )) {
      const events = precallsByTick.get(event.occurredAt) ?? [];
      events.push(event);
      precallsByTick.set(event.occurredAt, events);
    }
    const parallelBatch = [...precallsByTick.values()].find((events) => events.length >= 2);

    expect(parallelBatch).toHaveLength(3);
    expect(parallelBatch?.every((event) => event.aircraftId === null)).toBe(true);
    const communicationNumbers = parallelBatch?.map((event) => {
      const rotation = result.rotations.find((candidate) => candidate.id === event.rotationId);
      return rotation?.communicationNumber ?? Number.MAX_SAFE_INTEGER;
    });
    expect(communicationNumbers).toEqual(
      [...(communicationNumbers ?? [])].sort((left, right) => left - right),
    );
    const fourth = result.rotations.find((rotation) => rotation.communicationNumber === 4);
    expect(fourth).toMatchObject({ precalledAt: null, aircraftId: null, calledAt: null });
  });

  it("can disable automatic GO TO GATE without changing the queue execution", () => {
    const config = shortNormalConfig();
    config.adminParameters.eventAutomaticPrecallEnabled = false;
    const result = runSimulation(config);

    expect(result.events.some((event) => event.type === "FLIGHT_GROUP_PRECALLED")).toBe(false);
    expect(result.rotations.every((rotation) => rotation.precalledAt === null)).toBe(true);
    expect(result.metrics.precall.precalledGroups).toBe(0);
    expect(result.rotations.some((rotation) => rotation.calledAt)).toBe(true);
  });

  it(
    "never suppresses a fresh forecast only because the latest learning sample is old",
    () => {
      const result = runSimulation(simulationConfigForPreset("NORMAL"));
      const oldLearningSnapshots = result.snapshots.filter(
        (snapshot) => snapshot.dataAgeMinutes > 5 && snapshot.activeCapacity > 0,
      );

      expect(oldLearningSnapshots.length).toBeGreaterThan(0);
      expect(oldLearningSnapshots.every((snapshot) => snapshot.quality !== "UNCERTAIN")).toBe(true);
      expect(result.metrics.uncertaintyReasons.STALE_PREDICTION).toBe(0);
    },
    FORECAST_BASELINE_TIMEOUT_MS,
  );

  it("retains diagnostic raw times and reasons while hard uncertainty hides the countdown", () => {
    const result = runSimulation(simulationConfigForPreset("OPERATION_INTERRUPTION"));
    const uncertain = result.snapshots.find(
      (snapshot) =>
        snapshot.status === "DRAFT" &&
        snapshot.quality === "UNCERTAIN" &&
        snapshot.uncertaintyReasons.includes("OPERATION_INTERRUPTED"),
    );

    expect(uncertain).toMatchObject({
      countdownDisplayed: false,
      forecastState: "UNAVAILABLE",
      forecastReason: "OPERATIONS_INTERRUPTED",
    });
    expect(Date.parse(uncertain?.predictedBoardingAt ?? "")).not.toBeNaN();
    expect(Date.parse(uncertain?.predictedCompletionAt ?? "")).not.toBeNaN();
    expect(result.metrics.uncertaintyReasons.OPERATION_INTERRUPTED).toBeGreaterThan(0);
  });

  it("applies manual incidents only after an active rotation reaches a safe boundary", () => {
    const config = shortNormalConfig();
    const result = runSimulation(config, [
      {
        id: "manual-defect",
        type: "TECHNICAL_DEFECT",
        at: "2026-07-22T08:02:00.000Z",
        aircraftId: "aircraft-1",
        durationMinutes: 15,
        dayOutage: false,
      },
    ]);
    const defect = result.events.find((event) => event.type === "TECHNICAL_DEFECT_REPORTED");
    const returnEvent = result.events.find(
      (event) => event.type === "AIRCRAFT_RETURN_CONFIRMED" && event.aircraftId === "aircraft-1",
    );
    expect(defect).toBeDefined();
    expect(Date.parse(defect?.occurredAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse("2026-07-22T08:02:00.000Z"),
    );
    expect(Date.parse(returnEvent?.occurredAt ?? "")).toBeGreaterThan(
      Date.parse(defect?.occurredAt ?? ""),
    );
  });

  it("generates every configured automatic aircraft interruption at a completion boundary", () => {
    const config = shortNormalConfig();
    config.realityModel.incidents.refueling.everyRotations = 1;
    config.realityModel.incidents.plannedPause.everyOperatingMinutes = 1;
    config.realityModel.incidents.unplannedPause.ratePerOperatingHour = 1_000;
    config.realityModel.incidents.technicalDefect.ratePerOperatingHour = 1_000;
    config.realityModel.incidents.technicalDefect.dayOutageProbability = 1;
    const result = runSimulation(config);
    const types = new Set(result.events.map((event) => event.type));

    expect(types).toContain("REFUELING_STARTED");
    expect(types).toContain("PLANNED_PAUSE_STARTED");
    expect(types).toContain("UNPLANNED_PAUSE_STARTED");
    expect(types).toContain("AIRCRAFT_DAY_OUT");
    expect(types).toContain("AIRCRAFT_RETURN_CONFIRMED");
  });

  it(
    "covers the four acceptance presets including forced outage and interruption",
    () => {
      const normal = runSimulation(simulationConfigForPreset("NORMAL"));
      const peak = runSimulation(simulationConfigForPreset("PEAK_LOAD"));
      const outage = runSimulation(simulationConfigForPreset("AIRCRAFT_FAILURE"));
      const interruption = runSimulation(simulationConfigForPreset("OPERATION_INTERRUPTION"));

      expect(normal.config.adminParameters.aircraftCount).toBe(3);
      expect(
        calculateDemandSummary(
          normal.config.realityModel.demand,
          salesDurationMinutes(normal.config.schedule),
        ).averagePersonsPerHour,
      ).toBe(18);
      expect(
        calculateDemandSummary(
          peak.config.realityModel.demand,
          salesDurationMinutes(peak.config.schedule),
        ).averagePersonsPerHour,
      ).toBe(36);
      expect(outage.events.some((event) => event.type === "AIRCRAFT_DAY_OUT")).toBe(true);
      const interruptedAt = interruption.events.find((event) => event.type === "EVENT_INTERRUPTED");
      const resumedAt = interruption.events.find((event) => event.type === "EVENT_RESUMED");
      expect(
        (Date.parse(resumedAt?.occurredAt ?? "") - Date.parse(interruptedAt?.occurredAt ?? "")) /
          60_000,
      ).toBe(30);
    },
    FORECAST_BASELINE_TIMEOUT_MS,
  );
});
