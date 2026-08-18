import { describe, expect, it } from "vitest";

import { runSimulation } from "./engine";
import { demandForProfile, simulationConfigForPreset } from "./model";
import { createSimulationExport, SIMULATION_EXPORT_SCHEMA } from "./simulation-export";

const SIMULATION_TIMEOUT_MS = 60_000;

describe("forecast simulation export", () => {
  it(
    "writes the v8 metrics, nullable seed batch, schedule, demand profile, and run window",
    () => {
      const result = runSimulation(simulationConfigForPreset("NORMAL"));
      const exported = createSimulationExport(result, [], null);

      expect(SIMULATION_EXPORT_SCHEMA).toBe("rundflug-forecast-simulation/v8");
      expect(exported.schema).toBe("rundflug-forecast-simulation/v8");
      expect(exported.schedule).toEqual(result.config.schedule);
      expect(exported.realityModel.demand).toEqual(result.config.realityModel.demand);
      expect(exported.runWindow).toEqual(result.runWindow);
      expect(exported.metrics.initialBoarding).toEqual(result.metrics.initialBoarding);
      expect(exported.seedBatch).toBeNull();
      expect(Date.parse(exported.runWindow.endAt)).toBeGreaterThanOrEqual(
        Date.parse(exported.schedule.operationsEndAt),
      );
    },
    SIMULATION_TIMEOUT_MS,
  );

  it(
    "preserves product demand profiles in the exported scenario",
    () => {
      const config = simulationConfigForPreset("NORMAL");
      config.demandByProduct = {
        "product-a": demandForProfile("UNIFORM", 480, 6),
        "product-b": demandForProfile("LATE_RUSH", 480, 30),
      };
      const exported = createSimulationExport(runSimulation(config), [], null);

      expect(exported.scenario.demandByProduct).toEqual(config.demandByProduct);
    },
    SIMULATION_TIMEOUT_MS,
  );
});
