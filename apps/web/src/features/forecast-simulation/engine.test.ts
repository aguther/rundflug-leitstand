import { describe, expect, it } from "vitest";

import { runSimulation, sampleTriangular } from "./engine";
import { simulationConfigForPreset } from "./model";

function shortNormalConfig() {
  const config = simulationConfigForPreset("NORMAL");
  config.endAt = "2026-07-22T11:00:00.000Z";
  return config;
}

describe("local forecast simulation", () => {
  it("captures the approved preset baseline", () => {
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
        generated: 32,
        completed: 25,
        windowCoverage: 0,
        boardingMedian: 0.5,
        boardingP90: 27.3,
        averageWindowWidth: 0,
        maximumReactionSeconds: 29.648,
        uncertainCountdownViolations: 0,
        precall: {
          eligibleGroups: 28,
          precalledGroups: 26,
          coveragePercent: 92.86,
          medianGateWaitMinutes: 9.5,
          p90GateWaitMinutes: 29,
          sameTickCount: 5,
          uncertainPrecallCount: 0,
        },
      },
      PEAK_LOAD: {
        generated: 68,
        completed: 25,
        windowCoverage: 0,
        boardingMedian: 0.5,
        boardingP90: 23.5,
        averageWindowWidth: 0,
        maximumReactionSeconds: 29.648,
        uncertainCountdownViolations: 0,
        precall: {
          eligibleGroups: 28,
          precalledGroups: 26,
          coveragePercent: 92.86,
          medianGateWaitMinutes: 12.25,
          p90GateWaitMinutes: 29.5,
          sameTickCount: 5,
          uncertainPrecallCount: 0,
        },
      },
      AIRCRAFT_FAILURE: {
        generated: 32,
        completed: 20,
        windowCoverage: 0,
        boardingMedian: 0.5,
        boardingP90: 15.3,
        averageWindowWidth: 0,
        maximumReactionSeconds: 29.648,
        uncertainCountdownViolations: 0,
        precall: {
          eligibleGroups: 21,
          precalledGroups: 20,
          coveragePercent: 95.24,
          medianGateWaitMinutes: 9.5,
          p90GateWaitMinutes: 26.35,
          sameTickCount: 3,
          uncertainPrecallCount: 0,
        },
      },
      OPERATION_INTERRUPTION: {
        generated: 32,
        completed: 26,
        windowCoverage: 0,
        boardingMedian: 0.5,
        boardingP90: 28.7,
        averageWindowWidth: 0.4,
        maximumReactionSeconds: 29.648,
        uncertainCountdownViolations: 0,
        precall: {
          eligibleGroups: 28,
          precalledGroups: 26,
          coveragePercent: 92.86,
          medianGateWaitMinutes: 8.25,
          p90GateWaitMinutes: 26.75,
          sameTickCount: 6,
          uncertainPrecallCount: 0,
        },
      },
    });
  });

  it("is bit-for-bit reproducible for the same parameters and seed", () => {
    const config = shortNormalConfig();
    const first = runSimulation(config);
    const second = runSimulation(structuredClone(config));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.rotations.length).toBeGreaterThan(0);
    expect(first.snapshots.length).toBeGreaterThan(0);
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

  it("can disable automatic GO TO GATE without changing the queue execution", () => {
    const config = shortNormalConfig();
    config.adminParameters.eventAutomaticPrecallEnabled = false;
    const result = runSimulation(config);

    expect(result.events.some((event) => event.type === "FLIGHT_GROUP_PRECALLED")).toBe(false);
    expect(result.rotations.every((rotation) => rotation.precalledAt === null)).toBe(true);
    expect(result.metrics.precall.precalledGroups).toBe(0);
    expect(result.rotations.some((rotation) => rotation.calledAt)).toBe(true);
  });

  it("never suppresses a fresh forecast only because the latest learning sample is old", () => {
    const result = runSimulation(simulationConfigForPreset("NORMAL"));
    const oldLearningSnapshots = result.snapshots.filter(
      (snapshot) => snapshot.dataAgeMinutes > 5 && snapshot.activeCapacity > 0,
    );

    expect(oldLearningSnapshots.length).toBeGreaterThan(0);
    expect(oldLearningSnapshots.every((snapshot) => snapshot.quality !== "UNCERTAIN")).toBe(true);
    expect(result.metrics.uncertaintyReasons.STALE_PREDICTION).toBe(0);
  });

  it("retains diagnostic raw times and reasons while hard uncertainty hides the countdown", () => {
    const result = runSimulation(simulationConfigForPreset("OPERATION_INTERRUPTION"));
    const uncertain = result.snapshots.find(
      (snapshot) =>
        snapshot.quality === "UNCERTAIN" &&
        snapshot.uncertaintyReasons.includes("OPERATION_INTERRUPTED"),
    );

    expect(uncertain).toMatchObject({ countdownDisplayed: false });
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

  it("covers the four acceptance presets including forced outage and interruption", () => {
    const normal = runSimulation(simulationConfigForPreset("NORMAL"));
    const peak = runSimulation(simulationConfigForPreset("PEAK_LOAD"));
    const outage = runSimulation(simulationConfigForPreset("AIRCRAFT_FAILURE"));
    const interruption = runSimulation(simulationConfigForPreset("OPERATION_INTERRUPTION"));

    expect(normal.config.adminParameters.aircraftCount).toBe(3);
    expect(normal.config.realityModel.demandPersonsPerHour).toBe(18);
    expect(peak.config.realityModel.demandPersonsPerHour).toBe(36);
    expect(outage.events.some((event) => event.type === "AIRCRAFT_DAY_OUT")).toBe(true);
    const interruptedAt = interruption.events.find((event) => event.type === "EVENT_INTERRUPTED");
    const resumedAt = interruption.events.find((event) => event.type === "EVENT_RESUMED");
    expect(
      (Date.parse(resumedAt?.occurredAt ?? "") - Date.parse(interruptedAt?.occurredAt ?? "")) /
        60_000,
    ).toBe(30);
  });
});
