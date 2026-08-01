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

function validVersionTwoTemplate() {
  return {
    ...structuredClone(validTemplate),
    formatVersion: 2 as const,
    name: "Operative Variante",
    config: {
      ...structuredClone(validTemplate.config),
      adminParameters: {
        ...structuredClone(validTemplate.config.adminParameters),
        aircraftCount: 1,
        activePilotCount: 1,
      },
      operationalModel: {
        sourceName: "Rundflugtag",
        gates: [{ id: "gate-1", label: "Flight Line", travelLeadMinutes: 0 }],
        resourceGroups: [
          {
            id: "group-1",
            name: "Standard",
            shortCode: "STD",
            gateId: "gate-1",
            automaticPrecallEnabled: true,
          },
        ],
        aircraft: [
          {
            id: "aircraft-1",
            registration: "D-EABC",
            aircraftType: "C172",
            capacity: 3,
            refuelReminderThreshold: 5,
            resourceGroupId: "group-1",
          },
        ],
        pilots: [{ id: "pilot-1", operationalCode: "P-01", active: true }],
        products: [
          {
            id: "product-1",
            name: "Standardflug",
            code: "STD-20",
            resourceGroupId: "group-1",
            gateId: "gate-1",
            referenceCapacity: 3,
            referenceDurationMinutes: 20,
          },
        ],
      },
      demandByProduct: {
        "product-1": {
          profile: "CUSTOM" as const,
          windows: [{ startOffsetMinutes: 0, endOffsetMinutes: 480, personsPerHour: 18 }],
        },
      },
      plannedOperations: [
        {
          key: "plan-1",
          scopeType: "RESOURCE_GROUP" as const,
          scopeId: "group-1",
          kind: "PAUSE" as const,
          effectMode: "SLOWDOWN" as const,
          durationMultiplierPercent: 125,
          startMode: "TIME_WINDOW" as const,
          earliestStartAt: "2026-07-22T10:00:00.000Z",
          latestStartAt: "2026-07-22T10:30:00.000Z",
          afterRotationId: null,
          unresolvedAfterCurrentRotation: false,
          minimumDurationMinutes: 10,
          typicalDurationMinutes: 15,
          maximumDurationMinutes: 20,
          publicNote: "Verzögerter Betrieb",
        },
      ],
      recurringRules: [
        {
          key: "rule-1",
          scopeType: "AIRCRAFT" as const,
          scopeId: "aircraft-1",
          kind: "REFUELING" as const,
          triggerMetric: "COMPLETED_ROTATIONS" as const,
          intervalValue: 5,
          progressValue: 2,
          minimumDurationMinutes: 8,
          typicalDurationMinutes: 12,
          maximumDurationMinutes: 18,
        },
      ],
    },
  };
}

describe("simulation scenario template contract", () => {
  it("accepts the strict version 1 baseline format", () => {
    expect(simulationScenarioTemplateSchema.parse(validTemplate)).toEqual(validTemplate);
  });

  it("accepts a complete version 2 configuration", () => {
    const template = validVersionTwoTemplate();
    expect(simulationScenarioTemplateSchema.parse(template)).toEqual(template);
  });

  it("rejects missing fields, duplicate identifiers and dangling references in version 2", () => {
    const missingRules = structuredClone(validVersionTwoTemplate());
    Reflect.deleteProperty(missingRules.config, "recurringRules");
    expect(simulationScenarioTemplateSchema.safeParse(missingRules).success).toBe(false);

    const duplicateAircraft = structuredClone(validVersionTwoTemplate());
    const aircraft = duplicateAircraft.config.operationalModel.aircraft[0];
    if (!aircraft) throw new Error("Testflugzeug fehlt.");
    duplicateAircraft.config.operationalModel.aircraft.push(structuredClone(aircraft));
    expect(simulationScenarioTemplateSchema.safeParse(duplicateAircraft).success).toBe(false);

    const danglingProduct = structuredClone(validVersionTwoTemplate());
    const product = danglingProduct.config.operationalModel.products[0];
    if (!product) throw new Error("Testprodukt fehlt.");
    product.resourceGroupId = "group-missing";
    expect(simulationScenarioTemplateSchema.safeParse(danglingProduct).success).toBe(false);

    const validTemplateV2 = validVersionTwoTemplate();
    const ambiguousRotationReference = {
      ...validTemplateV2,
      config: {
        ...validTemplateV2.config,
        plannedOperations: validTemplateV2.config.plannedOperations.map((operation) => ({
          ...operation,
          startMode: "AFTER_CURRENT_ROTATION" as const,
          earliestStartAt: null,
          latestStartAt: null,
          afterRotationId: "rotation-001",
          unresolvedAfterCurrentRotation: true,
        })),
      },
    };
    expect(simulationScenarioTemplateSchema.safeParse(ambiguousRotationReference).success).toBe(
      false,
    );
  });

  it("rejects unknown scenario format versions", () => {
    expect(
      simulationScenarioTemplateSchema.safeParse({
        ...validVersionTwoTemplate(),
        formatVersion: 3,
      }).success,
    ).toBe(false);
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
