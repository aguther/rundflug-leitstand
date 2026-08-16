import type { ManualIncident, SimulationConfig } from "./model";
import { addSimulationMinutes, toSimulationIso } from "./simulation-primitives";

const GATE_ID = "simulation-gate";
const RESOURCE_GROUP_ID = "SIMULATION_FLEET";
const PRODUCT_ID = "SYNTHETIC_ROUND_TRIP";

/** Maps the compact preset/editor model to the same topology consumed by imported scenarios. */
export function withSyntheticOperationalModel(config: SimulationConfig): SimulationConfig {
  if (config.operationalModel) return config;
  const aircraft = Array.from({ length: config.adminParameters.aircraftCount }, (_, index) => ({
    id: `aircraft-${index + 1}`,
    registration: `D-SIM${String(index + 1).padStart(2, "0")}`,
    aircraftType: config.adminParameters.aircraftType,
    capacity: config.adminParameters.passengerSeats,
    resourceGroupId: RESOURCE_GROUP_ID,
  }));
  const pilots = Array.from({ length: config.adminParameters.activePilotCount }, (_, index) => ({
    id: `pilot-${index + 1}`,
    operationalCode: `P${String(index + 1).padStart(2, "0")}`,
    active: true,
  }));
  return {
    ...structuredClone(config),
    operationalModel: {
      sourceName: "Synthetisches operatives Preset",
      gates: [{ id: GATE_ID, label: "Simulations-Gate", travelLeadMinutes: 0 }],
      resourceGroups: [
        {
          id: RESOURCE_GROUP_ID,
          name: "Simulationsflotte",
          shortCode: "SIM",
          gateId: GATE_ID,
          automaticPrecallEnabled: config.adminParameters.resourceGroupAutomaticPrecallEnabled,
        },
      ],
      aircraft,
      pilots,
      products: [
        {
          id: PRODUCT_ID,
          name: "Synthetischer Rundflug",
          code: "SIM",
          resourceGroupId: RESOURCE_GROUP_ID,
          gateId: GATE_ID,
          referenceCapacity: config.adminParameters.passengerSeats,
          referenceDurationMinutes: config.adminParameters.productReferenceDurationMinutes,
        },
      ],
    },
    demandByProduct: { [PRODUCT_ID]: structuredClone(config.realityModel.demand) },
  };
}

export function syntheticPresetIncidents(config: SimulationConfig): ManualIncident[] {
  if (config.operationalModel) return [];
  const atMs = addSimulationMinutes(Date.parse(config.schedule.operationsStartAt), 120);
  if (atMs >= Date.parse(config.schedule.operationsEndAt)) return [];
  const at = toSimulationIso(atMs);
  if (config.preset === "AIRCRAFT_FAILURE") {
    return [
      {
        id: "preset-aircraft-failure",
        type: "TECHNICAL_DEFECT",
        at,
        aircraftId: "aircraft-2",
        durationMinutes: 0,
        dayOutage: true,
      },
    ];
  }
  if (config.preset === "OPERATION_INTERRUPTION") {
    return [
      {
        id: "preset-event-interruption",
        type: "EVENT_INTERRUPTION",
        at,
        aircraftId: null,
        durationMinutes: 30,
        dayOutage: false,
      },
    ];
  }
  return [];
}
