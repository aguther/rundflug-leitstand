import { describe, expect, it } from "vitest";

import {
  calculateDemandSummary,
  demandForProfile,
  rescaleDemandWindows,
  salesDurationMinutes,
  simulationConfigForPreset,
  validateSimulationConfig,
} from "./model";

describe("forecast simulation configuration", () => {
  it("defines the approved two-wave day in Europe/Berlin", () => {
    const config = simulationConfigForPreset("NORMAL");
    const summary = calculateDemandSummary(
      config.realityModel.demand,
      salesDurationMinutes(config.schedule),
    );

    expect(config.schedule).toEqual({
      timeZone: "Europe/Berlin",
      salesStartAt: "2026-07-22T07:00:00.000Z",
      salesEndAt: "2026-07-22T15:00:00.000Z",
      operationsStartAt: "2026-07-22T08:00:00.000Z",
      operationsEndAt: "2026-07-22T16:00:00.000Z",
    });
    expect(config.realityModel.demand).toEqual({
      profile: "TWO_WAVES",
      windows: [
        { startOffsetMinutes: 0, endOffsetMinutes: 90, personsPerHour: 40 },
        { startOffsetMinutes: 90, endOffsetMinutes: 270, personsPerHour: 8 },
        { startOffsetMinutes: 270, endOffsetMinutes: 360, personsPerHour: 32 },
        { startOffsetMinutes: 360, endOffsetMinutes: 480, personsPerHour: 6 },
      ],
    });
    expect(summary).toEqual({ averagePersonsPerHour: 18, expectedPersons: 144 });
    expect(validateSimulationConfig(config)).toEqual([]);
  });

  it("keeps the current demand level when switching templates", () => {
    const morning = demandForProfile("OPENING_RUSH", 480, 36);
    const late = demandForProfile("LATE_RUSH", 480, 36);
    const restartedFromZero = demandForProfile("TWO_WAVES", 480, 0);

    expect(calculateDemandSummary(morning, 480).averagePersonsPerHour).toBe(36);
    expect(calculateDemandSummary(late, 480).averagePersonsPerHour).toBe(36);
    expect(calculateDemandSummary(restartedFromZero, 480).averagePersonsPerHour).toBe(18);
    expect(morning.windows.map((window) => window.personsPerHour)).toEqual([84, 20]);
    expect(late.windows.map((window) => window.personsPerHour)).toEqual([20, 84]);
  });

  it("rescales window positions while preserving their rates", () => {
    const demand = demandForProfile("TWO_WAVES", 480);
    const resized = rescaleDemandWindows(demand, 480, 600);

    expect(resized.windows).toEqual([
      { startOffsetMinutes: 0, endOffsetMinutes: 113, personsPerHour: 40 },
      { startOffsetMinutes: 113, endOffsetMinutes: 338, personsPerHour: 8 },
      { startOffsetMinutes: 338, endOffsetMinutes: 450, personsPerHour: 32 },
      { startOffsetMinutes: 450, endOffsetMinutes: 600, personsPerHour: 6 },
    ]);
  });

  it("allows zero-demand gaps but rejects overlaps and out-of-range windows", () => {
    const withGap = simulationConfigForPreset("NORMAL");
    withGap.realityModel.demand = {
      profile: "CUSTOM",
      windows: [
        { startOffsetMinutes: 0, endOffsetMinutes: 60, personsPerHour: 0 },
        { startOffsetMinutes: 120, endOffsetMinutes: 180, personsPerHour: 30 },
      ],
    };
    expect(validateSimulationConfig(withGap)).toEqual([]);

    const invalid = structuredClone(withGap);
    invalid.realityModel.demand.windows = [
      { startOffsetMinutes: 0, endOffsetMinutes: 150, personsPerHour: 10 },
      { startOffsetMinutes: 120, endOffsetMinutes: 500, personsPerHour: -1 },
    ];
    expect(validateSimulationConfig(invalid)).toEqual(
      expect.arrayContaining([
        "Nachfragefenster 2 liegt außerhalb des Verkaufszeitraums.",
        "Nachfragefenster 2 besitzt eine ungültige Nachfrage.",
        "Nachfragefenster 1 und 2 überlappen sich.",
      ]),
    );
  });

  it("rejects cross-day and inconsistent sales and operations boundaries", () => {
    const config = simulationConfigForPreset("NORMAL");
    config.schedule.salesEndAt = "2026-07-22T17:00:00.000Z";
    config.schedule.operationsEndAt = "2026-07-23T01:00:00.000Z";

    expect(validateSimulationConfig(config)).toContain(
      "Verkauf und Flugbetrieb müssen am selben Veranstaltungstag liegen.",
    );
  });
});
