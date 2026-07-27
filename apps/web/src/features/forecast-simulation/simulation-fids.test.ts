import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type SimulationEvent,
  type SimulationForecastSnapshot,
  type SimulationResult,
  type SimulationRotation,
  simulationConfigForPreset,
} from "./model";
import {
  advanceRecentDepartures,
  createRecentDepartureState,
  createSimulationFidsBoard,
  recentDepartureIds,
  SIMULATION_DEPARTED_MINIMUM_VISIBILITY_MS,
  SIMULATION_DEPARTED_VISIBILITY_MS,
  simulationDepartedVisibilityMs,
} from "./simulation-fids";

const START_MS = Date.parse("2026-07-22T08:00:00.000Z");
const at = (minutes: number) => new Date(START_MS + minutes * 60_000).toISOString();

function rotation(
  id: string,
  communicationNumber: number,
  overrides: Partial<SimulationRotation> = {},
): SimulationRotation {
  return {
    id,
    communicationNumber,
    passengerCount: 4,
    createdAt: at(0),
    precalledAt: null,
    precallTrigger: null,
    precallPredictionQuality: null,
    precallPredictedBoardingAt: null,
    precallAdaptiveLeadMinutes: null,
    aircraftId: null,
    calledAt: null,
    departedAt: null,
    landedAt: null,
    completedAt: null,
    boardingMinutes: null,
    flightMinutes: null,
    deboardingMinutes: null,
    bufferMinutes: null,
    ...overrides,
  };
}

function snapshot(
  rotationId: string,
  overrides: Partial<SimulationForecastSnapshot> = {},
): SimulationForecastSnapshot {
  return {
    rotationId,
    capturedAt: at(50),
    status: "DRAFT",
    quality: "STABLE",
    lowerMinutes: 10,
    upperMinutes: 20,
    plannedBoardingAt: at(70),
    predictedBoardingAt: at(70),
    predictedDepartureAt: at(80),
    predictedLandingAt: at(100),
    predictedCompletionAt: at(110),
    sampleSize: 8,
    dataAgeMinutes: 1,
    activeCapacity: 3,
    uncertaintyReasons: [],
    countdownDisplayed: true,
    ...overrides,
  };
}

function result(input: {
  rotations: SimulationRotation[];
  snapshots?: SimulationForecastSnapshot[];
  events?: SimulationEvent[];
}): SimulationResult {
  return {
    config: simulationConfigForPreset("NORMAL"),
    runWindow: {
      startAt: at(0),
      endAt: at(600),
    },
    aircraft: [
      {
        id: "aircraft-1",
        registration: "D-SIM01",
        aircraftType: "Simulation 4S",
        capacity: 4,
      },
    ],
    rotations: input.rotations,
    events: input.events ?? [],
    snapshots: input.snapshots ?? [],
    metrics: {} as SimulationResult["metrics"],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("simulation FIDS projection", () => {
  it("uses only visible state, preserves public ordering and excludes stale departures", () => {
    const waiting = rotation("waiting", 3);
    const gate = rotation("gate", 2, { precalledAt: at(55) });
    const boarding = rotation("boarding", 1, {
      aircraftId: "aircraft-1",
      calledAt: at(55),
    });
    const departed = rotation("departed", 4, {
      aircraftId: "aircraft-1",
      calledAt: at(40),
      departedAt: at(59),
      landedAt: at(80),
      completedAt: at(90),
    });
    const staleDeparture = rotation("stale-departure", 5, {
      calledAt: at(20),
      departedAt: at(30),
    });
    const future = rotation("future", 6, { createdAt: at(61) });
    const board = createSimulationFidsBoard({
      result: result({
        rotations: [waiting, gate, boarding, departed, staleDeparture, future],
        snapshots: [
          snapshot(waiting.id),
          snapshot(waiting.id, {
            capturedAt: at(61),
            quality: "UNCERTAIN",
            predictedBoardingAt: at(90),
          }),
        ],
      }),
      visibleAt: Date.parse(at(60)),
      recentDepartedRotationIds: new Set([departed.id]),
    });

    expect(board.groups.map((group) => [group.communicationNumber, group.status])).toEqual([
      [1, "BOARDING"],
      [2, "COME_TO_FLIGHT_LINE"],
      [3, "WAITING"],
      [4, "IN_FLIGHT"],
    ]);
    const waitingGroup = board.groups[2];
    expect(waitingGroup).toMatchObject({
      productCode: "SIM",
      productName: "Rundflug Simulation",
      gateLabel: "Flight Line 1",
      boardingWindowLowerAt: at(70),
      boardingWindowUpperAt: at(80),
      predictionQuality: "STABLE",
    });
    expect(waitingGroup?.ticketLabels).toEqual([
      "G-SIM-0003/1",
      "G-SIM-0003/2",
      "G-SIM-0003/3",
      "G-SIM-0003/4",
    ]);
    expect(board.groups[0]?.boardingWindowLowerAt).toBeNull();
    expect(JSON.stringify(board)).not.toMatch(/guestName|phoneNumber|publicCode|sessionId/i);
  });

  it("marks interruption state and suppresses otherwise visible forecast windows", () => {
    const waiting = rotation("waiting", 1);
    const board = createSimulationFidsBoard({
      result: result({
        rotations: [waiting],
        snapshots: [snapshot(waiting.id)],
        events: [
          {
            id: "event-1",
            type: "EVENT_INTERRUPTED",
            occurredAt: at(55),
            aircraftId: null,
            rotationId: null,
            details: "Synthetische Unterbrechung",
            forecastRecalculatedAt: at(55),
          },
        ],
      }),
      visibleAt: Date.parse(at(60)),
      recentDepartedRotationIds: new Set(),
    });

    expect(board.operationalInterrupted).toBe(true);
    expect(board.groups[0]).toMatchObject({
      status: "WAITING",
      predictionQuality: "UNCERTAIN",
      boardingWindowLowerAt: null,
      boardingWindowUpperAt: null,
      waitLowerMinutes: 0,
      waitUpperMinutes: 0,
    });
  });

  it("projects imported product, gate and active public plan notices", () => {
    const importedRotation = rotation("imported", 7, {
      productId: "product-1",
      productName: "Alpenrunde",
      productCode: "ALP",
      resourceGroupId: "group-1",
      gateLabel: "Gate Süd",
    });
    const importedResult = result({
      rotations: [importedRotation],
      snapshots: [snapshot(importedRotation.id)],
      events: [
        {
          id: "plan-start",
          type: "PLANNED_OPERATION_STARTED",
          occurredAt: at(55),
          aircraftId: null,
          plannedOperationId: "plan-group",
          rotationId: null,
          details: "Flugshow",
          forecastRecalculatedAt: at(55),
        },
      ],
    });
    importedResult.config.operationalModel = {
      sourceName: "Flugtag Alpen",
      gates: [{ id: "gate-1", label: "Gate Süd" }],
      resourceGroups: [
        {
          id: "group-1",
          name: "Alpen",
          shortCode: "ALP",
          gateId: "gate-1",
          automaticPrecallEnabled: true,
        },
      ],
      aircraft: importedResult.aircraft,
      pilots: [],
      products: [
        {
          id: "product-1",
          name: "Alpenrunde",
          code: "ALP",
          resourceGroupId: "group-1",
          gateId: "gate-1",
          referenceCapacity: 4,
          referenceDurationMinutes: 20,
        },
      ],
    };
    importedResult.plannedOperations = [
      {
        key: "plan-group",
        scopeType: "RESOURCE_GROUP",
        scopeId: "group-1",
        kind: "FLIGHT_SHOW",
        startMode: "TIME_WINDOW",
        earliestStartAt: at(55),
        latestStartAt: at(55),
        afterRotationId: null,
        unresolvedAfterCurrentRotation: false,
        minimumDurationMinutes: 20,
        typicalDurationMinutes: 20,
        maximumDurationMinutes: 20,
        publicNote: "Flugshow – bitte am Gate warten",
      },
    ];

    const board = createSimulationFidsBoard({
      result: importedResult,
      visibleAt: Date.parse(at(60)),
      recentDepartedRotationIds: new Set(),
    });

    expect(board.eventName).toBe("Flugtag Alpen");
    expect(board.groups[0]).toMatchObject({
      productName: "Alpenrunde",
      productCode: "ALP",
      gateLabel: "Gate Süd",
      predictionQuality: "UNCERTAIN",
      operationalNotice: "Flugshow – bitte am Gate warten",
    });
  });
});

describe("simulation FIDS departure observation", () => {
  it.each([
    [1, 15_000],
    [10, 1_500],
    [60, 1_000],
    [300, 1_000],
  ])("scales departure visibility for %sx playback to %sms", (speed, expected) => {
    expect(simulationDepartedVisibilityMs(speed)).toBe(expected);
  });

  it("retains every departure crossed by a jump for the playback-adjusted wall time", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-24T10:00:00.000Z");
    const visibilityMs = simulationDepartedVisibilityMs(10);
    const rotations = [
      rotation("one", 1, { departedAt: at(5) }),
      rotation("two", 2, { departedAt: at(8) }),
    ];
    let state = createRecentDepartureState(Date.parse(at(0)), visibilityMs);
    state = advanceRecentDepartures({
      state,
      rotations,
      visibleAt: Date.parse(at(10)),
      wallNow: Date.now(),
      visibilityMs,
    });

    expect(recentDepartureIds(state, Date.now(), visibilityMs)).toEqual(new Set(["one", "two"]));
    vi.advanceTimersByTime(visibilityMs - 1);
    expect(recentDepartureIds(state, Date.now(), visibilityMs)).toEqual(new Set(["one", "two"]));
    vi.advanceTimersByTime(1);
    expect(recentDepartureIds(state, Date.now(), visibilityMs)).toEqual(new Set());
  });

  it("applies speed changes to visible departures without reviving expired entries", () => {
    const departed = rotation("one", 1, { departedAt: at(5) });
    const normalVisibilityMs = simulationDepartedVisibilityMs(1);
    const acceleratedVisibilityMs = simulationDepartedVisibilityMs(300);
    let state = advanceRecentDepartures({
      state: createRecentDepartureState(Date.parse(at(0)), normalVisibilityMs),
      rotations: [departed],
      visibleAt: Date.parse(at(10)),
      wallNow: 1_000,
      visibilityMs: normalVisibilityMs,
    });

    state = advanceRecentDepartures({
      state,
      rotations: [departed],
      visibleAt: Date.parse(at(10)),
      wallNow: 2_001,
      visibilityMs: acceleratedVisibilityMs,
    });
    expect(state.observedAtByRotationId).toEqual({});
    expect(recentDepartureIds(state, 2_001, normalVisibilityMs)).toEqual(new Set());
  });

  it("clears observed departures on restart or backward time movement", () => {
    const departed = rotation("one", 1, { departedAt: at(5) });
    const observed = advanceRecentDepartures({
      state: createRecentDepartureState(Date.parse(at(0))),
      rotations: [departed],
      visibleAt: Date.parse(at(10)),
      wallNow: 1_000,
      visibilityMs: SIMULATION_DEPARTED_VISIBILITY_MS,
    });

    expect(
      advanceRecentDepartures({
        state: observed,
        rotations: [departed],
        visibleAt: Date.parse(at(0)),
        wallNow: 2_000,
        visibilityMs: SIMULATION_DEPARTED_VISIBILITY_MS,
      }).observedAtByRotationId,
    ).toEqual({});
    expect(
      advanceRecentDepartures({
        state: observed,
        rotations: [departed],
        visibleAt: Date.parse(at(10)),
        wallNow: 2_000,
        visibilityMs: SIMULATION_DEPARTED_MINIMUM_VISIBILITY_MS,
        reset: true,
      }).observedAtByRotationId,
    ).toEqual({});
  });
});
