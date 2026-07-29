import { describe, expect, it } from "vitest";

import { runSimulation } from "./engine";
import { demandForProfile, simulationConfigForPreset } from "./model";
import { createSimulationExport, SIMULATION_EXPORT_SCHEMA } from "./simulation-export";

describe("forecast simulation export", () => {
  it("writes the v6 schedule, demand profile, resource model, and actual run window", () => {
    const result = runSimulation(simulationConfigForPreset("NORMAL"));
    const exported = createSimulationExport(result, [], null);

    expect(exported.schema).toBe(SIMULATION_EXPORT_SCHEMA);
    expect(exported.schedule).toEqual(result.config.schedule);
    expect(exported.realityModel.demand).toEqual(result.config.realityModel.demand);
    expect(exported.runWindow).toEqual(result.runWindow);
    expect(Date.parse(exported.runWindow.endAt)).toBeGreaterThanOrEqual(
      Date.parse(exported.schedule.operationsEndAt),
    );
  });

  it("preserves product demand profiles in the exported scenario", () => {
    const config = simulationConfigForPreset("NORMAL");
    config.demandByProduct = {
      "product-a": demandForProfile("UNIFORM", 480, 6),
      "product-b": demandForProfile("LATE_RUSH", 480, 30),
    };
    const exported = createSimulationExport(runSimulation(config), [], null);

    expect(exported.scenario.demandByProduct).toEqual(config.demandByProduct);
  });
});
