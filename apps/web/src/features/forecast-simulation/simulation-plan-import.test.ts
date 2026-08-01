import { describe, expect, it } from "vitest";

import {
  calculateDemandSummary,
  calculateSimulationDemandSummary,
  SIMULATION_PRESET_LABELS,
  type SimulationPresetId,
  simulationConfigForPreset,
  validateSimulationConfig,
} from "./model";
import {
  excludeUnresolvedPlannedOperations,
  MAX_SIMULATION_PLAN_FILE_BYTES,
  parseSimulationPlanFile,
  parseSimulationPlanImport,
  SimulationPlanImportError,
} from "./simulation-plan-import";
import {
  createSimulationScenarioTemplate,
  simulationScenarioTemplateFileName,
} from "./simulation-scenario-template";

function simulationPlan() {
  return {
    format: "rundflug-simulation-plan",
    formatVersion: 1,
    exportedAt: "2026-07-24T10:00:00.000Z",
    source: { name: "Rundflugtag", version: 4 },
    schedule: {
      timeZone: "Europe/Berlin",
      salesStartAt: "2026-07-24T07:00:00.000Z",
      salesEndAt: "2026-07-24T15:00:00.000Z",
      operationsStartAt: "2026-07-24T08:00:00.000Z",
      operationsEndAt: "2026-07-24T16:00:00.000Z",
    },
    masterData: {
      format: "rundflug-master-data-template",
      formatVersion: 1,
      exportedAt: "2026-07-24T10:00:00.000Z",
      source: { name: "Rundflugtag", version: 4 },
      eventParameters: {
        noShowAfterMinutes: 10,
        maxTicketDeferrals: 2,
        notificationLeadMinutes: 15,
        automaticPrecallEnabled: true,
        precallLeadMinutes: 15,
        maximumGateWaitMinutes: 20,
        precallMinimumQuality: "CHANGING",
        precallGateCooldownMinutes: 2,
        referenceWeightsKg: { child: 35, normal: 80, heavy: 110 },
        plannedBoardingMinutes: 8,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 3,
        departedVisibilitySeconds: 15,
      },
      gates: [
        {
          key: "gate-1",
          label: "Flight Line",
          gateType: "FLIGHT_LINE",
          active: true,
          sortOrder: 10,
          travelLeadMinutes: 6,
          displayFilter: { productKeys: ["product-1"], rotationStatuses: [] },
        },
      ],
      resourceGroups: [
        {
          key: "group-1",
          name: "Standard",
          shortCode: "STD",
          gateKey: "gate-1",
          referenceCapacity: 3,
          plannedRotationMinutes: 20,
          compatibleAircraftTypes: ["C172"],
          automaticPrecallEnabled: true,
        },
      ],
      aircraft: [
        {
          key: "aircraft-1",
          registration: "D-EABC",
          aircraftType: "C172",
          passengerSeats: 3,
          maximumPassengerPayloadKg: null,
          refuelReminderThreshold: 5,
        },
      ],
      assignments: [{ aircraftKey: "aircraft-1", resourceGroupKey: "group-1" }],
      pilots: [
        {
          key: "pilot-1",
          operationalCode: "P-01",
          operationalNote: "",
          active: true,
        },
      ],
      products: [
        {
          key: "product-1",
          resourceGroupKey: "group-1",
          gateKey: "gate-1",
          name: "Standardflug",
          code: "STD-20",
          publicDescription: "",
          priceCents: 5000,
          referenceCapacity: 3,
          referenceDurationMinutes: 20,
          promisedFlightMinutes: 15,
          childCompanionRequired: false,
          weightClasses: ["NOT_CAPTURED"],
          sortOrder: 10,
          capacityWarningThreshold: 12,
          capacityCriticalThreshold: 4,
        },
      ],
    },
    plannedOperations: [
      {
        key: "plan-1",
        scopeType: "AIRCRAFT",
        scopeKey: "aircraft-1",
        kind: "REFUELING",
        startMode: "AFTER_CURRENT_ROTATION",
        earliestStartAt: null,
        latestStartAt: null,
        afterCurrentRotation: true,
        minimumDurationMinutes: 10,
        typicalDurationMinutes: 12,
        maximumDurationMinutes: 15,
        publicNote: "",
      },
    ],
  };
}

describe("simulation plan import", () => {
  it.each(Object.keys(SIMULATION_PRESET_LABELS) as SimulationPresetId[])(
    "round-trips the built-in %s scenario as a complete V2 template",
    (preset) => {
      const config = simulationConfigForPreset(preset);
      const name = SIMULATION_PRESET_LABELS[preset];
      const exported = createSimulationScenarioTemplate(name, config, "2026-07-28T12:00:00.000Z");
      const preview = parseSimulationPlanImport(JSON.stringify(exported), config);

      expect(exported.formatVersion).toBe(2);
      expect(preview).toMatchObject({
        sourceName: name,
        format: "rundflug-simulation-scenario",
        category: "SCENARIO",
      });
      expect(preview.config).toEqual(config);
      expect(validateSimulationConfig(preview.config)).toEqual([]);
    },
  );

  it("keeps version 1 scenario templates import-compatible", () => {
    const config = simulationConfigForPreset("NORMAL");
    const legacyTemplate = {
      format: "rundflug-simulation-scenario",
      formatVersion: 1,
      exportedAt: "2026-07-28T12:00:00.000Z",
      name: "Legacy-Normalbetrieb",
      config: {
        preset: config.preset,
        seed: config.seed,
        schedule: config.schedule,
        adminParameters: config.adminParameters,
        realityModel: config.realityModel,
        forecastTuning: config.forecastTuning,
      },
    };

    const preview = parseSimulationPlanImport(JSON.stringify(legacyTemplate), config);

    expect(preview.sourceName).toBe("Legacy-Normalbetrieb");
    expect(preview.config).toEqual(config);
  });

  it("round-trips every configurable value of an operational variant", () => {
    const baseConfig = simulationConfigForPreset("NORMAL");
    const plan = {
      ...simulationPlan(),
      formatVersion: 2,
      recurringRules: [
        {
          key: "rule-1",
          scopeType: "AIRCRAFT",
          scopeKey: "aircraft-1",
          kind: "REFUELING",
          triggerMetric: "COMPLETED_ROTATIONS",
          intervalValue: 5,
          progressValue: 3,
          minimumDurationMinutes: 8,
          typicalDurationMinutes: 12,
          maximumDurationMinutes: 18,
        },
      ],
    };
    const configured = parseSimulationPlanImport(JSON.stringify(plan), baseConfig).config;
    const exported = createSimulationScenarioTemplate(
      "Operative Variante",
      configured,
      "2026-07-28T12:00:00.000Z",
    );
    const restored = parseSimulationPlanImport(JSON.stringify(exported), baseConfig);

    expect(restored.sourceName).toBe("Operative Variante");
    expect(restored.counts).toMatchObject({
      gates: 1,
      resourceGroups: 1,
      aircraft: 1,
      pilots: 1,
      products: 1,
      plannedOperations: 1,
      recurringRules: 1,
      unresolvedAfterCurrentRotation: 1,
    });
    expect(restored.config).toEqual(configured);
  });

  it("uses a stable, editable scenario filename", () => {
    expect(simulationScenarioTemplateFileName("Normalbetrieb")).toBe(
      "rundflug-szenario-normalbetrieb.json",
    );
    expect(simulationScenarioTemplateFileName("Betriebsunterbrechung")).toBe(
      "rundflug-szenario-betriebsunterbrechung.json",
    );
    expect(simulationScenarioTemplateFileName("")).toBe(
      "rundflug-szenario-unbenannte-variante.json",
    );
  });

  it("rejects files above the shared one MiB boundary before reading them", async () => {
    let read = false;
    await expect(
      parseSimulationPlanFile(
        {
          size: MAX_SIMULATION_PLAN_FILE_BYTES + 1,
          text: () => {
            read = true;
            return Promise.resolve("{}");
          },
        },
        simulationConfigForPreset("NORMAL"),
      ),
    ).rejects.toThrow("größer als 1 MiB");
    expect(read).toBe(false);
  });

  it("maps only the safe topology and preserves unresolved after-rotation semantics", () => {
    const preview = parseSimulationPlanImport(
      JSON.stringify(simulationPlan()),
      simulationConfigForPreset("NORMAL"),
    );

    expect(preview.counts).toMatchObject({
      resourceGroups: 1,
      aircraft: 1,
      pilots: 1,
      products: 1,
      plannedOperations: 1,
      unresolvedAfterCurrentRotation: 1,
    });
    expect(preview.config.operationalModel?.aircraft[0]).toMatchObject({
      id: "aircraft-1",
      resourceGroupId: "group-1",
    });
    expect(preview.config.operationalModel?.gates[0]).toMatchObject({
      id: "gate-1",
      travelLeadMinutes: 6,
    });
    expect(validateSimulationConfig(preview.config).join(" ")).toContain(
      "muss vor dem Lauf umgewandelt oder ausgeschlossen werden",
    );
    expect(validateSimulationConfig(excludeUnresolvedPlannedOperations(preview))).toEqual([]);
  });

  it("also accepts the existing master-data template without inventing plans", () => {
    const value = simulationPlan();
    const preview = parseSimulationPlanImport(
      JSON.stringify(value.masterData),
      simulationConfigForPreset("NORMAL"),
    );

    expect(preview.format).toBe("rundflug-master-data-template");
    expect(preview.config.plannedOperations).toEqual([]);
    expect(preview.warnings.join(" ")).toContain("keinen Tageszeitplan");
  });

  it("keeps 18 persons per hour as the total default across imported products", () => {
    const value = simulationPlan();
    const sourceProduct = value.masterData.products[0];
    if (!sourceProduct) throw new Error("Das Testprodukt fehlt.");
    value.masterData.products.push({
      ...sourceProduct,
      key: "product-2",
      name: "Langflug",
      code: "LNG-30",
      referenceDurationMinutes: 30,
      promisedFlightMinutes: 25,
      sortOrder: 20,
    });
    const preview = parseSimulationPlanImport(
      JSON.stringify(value),
      simulationConfigForPreset("NORMAL"),
    );

    expect(preview.counts.products).toBe(2);
    expect(calculateSimulationDemandSummary(preview.config)).toEqual({
      averagePersonsPerHour: 18,
      expectedPersons: 144,
    });
    expect(
      Object.values(preview.config.demandByProduct ?? {}).map(
        (demand) => calculateDemandSummary(demand, 480).averagePersonsPerHour,
      ),
    ).toEqual([9, 9]);
  });

  it("imports V2 recurring rules and keeps the confirmed progress", () => {
    const value = {
      ...simulationPlan(),
      formatVersion: 2,
      recurringRules: [
        {
          key: "rule-1",
          scopeType: "AIRCRAFT",
          scopeKey: "aircraft-1",
          kind: "REFUELING",
          triggerMetric: "COMPLETED_ROTATIONS",
          intervalValue: 5,
          progressValue: 3,
          minimumDurationMinutes: 8,
          typicalDurationMinutes: 12,
          maximumDurationMinutes: 18,
        },
      ],
    };
    const preview = parseSimulationPlanImport(
      JSON.stringify(value),
      simulationConfigForPreset("NORMAL"),
    );
    expect(preview.counts.recurringRules).toBe(1);
    expect(preview.config.recurringRules?.[0]).toMatchObject({
      scopeId: "aircraft-1",
      progressValue: 3,
    });
  });

  it("rejects malformed or expanded payloads", () => {
    expect(() => parseSimulationPlanImport("{", simulationConfigForPreset("NORMAL"))).toThrow(
      SimulationPlanImportError,
    );
    expect(() =>
      parseSimulationPlanImport(
        JSON.stringify({ ...simulationPlan(), tickets: [] }),
        simulationConfigForPreset("NORMAL"),
      ),
    ).toThrow(SimulationPlanImportError);
    const expandedScenario = {
      ...createSimulationScenarioTemplate(
        "Normalbetrieb",
        simulationConfigForPreset("NORMAL"),
        "2026-07-28T12:00:00.000Z",
      ),
      queues: [],
    };
    expect(() =>
      parseSimulationPlanImport(
        JSON.stringify(expandedScenario),
        simulationConfigForPreset("NORMAL"),
      ),
    ).toThrow(SimulationPlanImportError);
  });
});
