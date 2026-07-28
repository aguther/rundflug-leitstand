import { describe, expect, it } from "vitest";

import { simulationScenarioTemplateSchema } from "./index";

const validTemplate = {
  format: "rundflug-simulation-scenario",
  formatVersion: 1,
  exportedAt: "2026-07-28T12:00:00.000Z",
  name: "Normalbetrieb",
  config: {
    preset: "NORMAL",
    seed: 20260722,
    schedule: {
      timeZone: "Europe/Berlin",
      salesStartAt: "2026-07-22T07:00:00.000Z",
      salesEndAt: "2026-07-22T15:00:00.000Z",
      operationsStartAt: "2026-07-22T08:00:00.000Z",
      operationsEndAt: "2026-07-22T16:00:00.000Z",
    },
    adminParameters: {
      plannedBoardingMinutes: 8,
      productReferenceDurationMinutes: 20,
      plannedDeboardingMinutes: 5,
      plannedBufferMinutes: 3,
      eventAutomaticPrecallEnabled: true,
      resourceGroupAutomaticPrecallEnabled: true,
      aircraftCount: 3,
      aircraftType: "Simulation 4S",
      passengerSeats: 4,
      activePilotCount: 3,
    },
    realityModel: {
      demand: {
        profile: "TWO_WAVES",
        windows: [{ startOffsetMinutes: 0, endOffsetMinutes: 480, personsPerHour: 18 }],
      },
      phases: {
        boarding: { minimum: 5, typical: 8, maximum: 12 },
        flight: { minimum: 16, typical: 20, maximum: 28 },
        deboarding: { minimum: 3, typical: 5, maximum: 8 },
        buffer: { minimum: 0, typical: 3, maximum: 8 },
      },
      incidents: {
        refueling: {
          enabled: true,
          everyRotations: 5,
          duration: { minimum: 8, typical: 12, maximum: 18 },
        },
        plannedPause: {
          enabled: true,
          everyOperatingMinutes: 120,
          duration: { minimum: 15, typical: 20, maximum: 30 },
        },
        unplannedPause: {
          enabled: true,
          ratePerOperatingHour: 0.2,
          duration: { minimum: 5, typical: 12, maximum: 25 },
        },
        technicalDefect: {
          enabled: true,
          ratePerOperatingHour: 0.08,
          dayOutageProbability: 0.2,
          duration: { minimum: 15, typical: 45, maximum: 120 },
        },
      },
    },
    forecastTuning: {
      forecast: {
        maximumSamples: 12,
        referenceWeight: 1,
        firstSampleWeight: 2,
        recencyWeightIncrement: 1,
        referenceOutlierMultiplier: 1.75,
        madMultiplier: 3,
        minimumMadToleranceRatio: 0.5,
        stableMinimumSamples: 5,
        stableMaximumMeanDeviationMinutes: 5,
        stableMarginMinutes: 5,
        changingMarginMinutes: 10,
      },
      precall: {
        desiredGateWaitMinutes: 8,
        baselineLeadMinutes: 12,
        minimumLeadMinutes: 6,
        maximumLeadMinutes: 18,
        correctionFactor: 0.5,
        observationSampleLimit: 8,
        gateCooldownMinutes: 2,
      },
      comparisonRuns: 25,
      availabilityModel: "TIME_DEPENDENT",
    },
  },
} as const;

describe("simulation scenario template contract", () => {
  it("accepts the strict version 1 baseline format", () => {
    expect(simulationScenarioTemplateSchema.parse(validTemplate)).toEqual(validTemplate);
  });

  it("rejects expanded payloads and invalid distributions", () => {
    expect(
      simulationScenarioTemplateSchema.safeParse({ ...validTemplate, tickets: [] }).success,
    ).toBe(false);
    expect(
      simulationScenarioTemplateSchema.safeParse({
        ...validTemplate,
        config: {
          ...validTemplate.config,
          realityModel: {
            ...validTemplate.config.realityModel,
            phases: {
              ...validTemplate.config.realityModel.phases,
              flight: { minimum: 30, typical: 20, maximum: 10 },
            },
          },
        },
      }).success,
    ).toBe(false);
  });
});
