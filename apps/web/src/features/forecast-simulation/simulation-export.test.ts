import { describe, expect, it } from "vitest";

import { runSimulation } from "./engine";
import { simulationConfigForPreset } from "./model";
import { createSimulationExport, SIMULATION_EXPORT_SCHEMA } from "./simulation-export";

describe("forecast simulation export", () => {
  it("writes the v5 schedule, demand profile, and actual run window", () => {
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
});
