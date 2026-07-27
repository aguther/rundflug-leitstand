import {
  type MasterDataTemplate,
  masterDataTemplateSchema,
  type SimulationPlanExport,
  simulationPlanExportSchema,
} from "@rundflug/contracts";

import {
  demandForProfile,
  type SimulationConfig,
  type SimulationOperationalModel,
  type SimulationPlannedOperation,
  type SimulationRecurringOperationalRule,
  salesDurationMinutes,
} from "./model";

export const MAX_SIMULATION_PLAN_FILE_BYTES = 1_048_576;

export interface SimulationPlanImportPreview {
  sourceName: string;
  format: "rundflug-simulation-plan" | "rundflug-master-data-template";
  config: SimulationConfig;
  counts: {
    gates: number;
    resourceGroups: number;
    aircraft: number;
    pilots: number;
    products: number;
    plannedOperations: number;
    recurringRules: number;
    unresolvedAfterCurrentRotation: number;
  };
  warnings: string[];
}

export class SimulationPlanImportError extends Error {}

function createOperationalModel(template: MasterDataTemplate): SimulationOperationalModel {
  const assignmentByAircraftKey = new Map(
    template.assignments.map((entry) => [entry.aircraftKey, entry.resourceGroupKey]),
  );
  return {
    sourceName: template.source.name,
    gates: template.gates.map((entry) => ({ id: entry.key, label: entry.label })),
    resourceGroups: template.resourceGroups.map((entry) => ({
      id: entry.key,
      name: entry.name,
      shortCode: entry.shortCode,
      gateId: entry.gateKey,
      automaticPrecallEnabled: entry.automaticPrecallEnabled,
    })),
    aircraft: template.aircraft.map((entry) => ({
      id: entry.key,
      registration: entry.registration,
      aircraftType: entry.aircraftType,
      capacity: entry.passengerSeats,
      refuelReminderThreshold: entry.refuelReminderThreshold,
      ...(assignmentByAircraftKey.has(entry.key)
        ? { resourceGroupId: assignmentByAircraftKey.get(entry.key) as string }
        : {}),
    })),
    pilots: template.pilots.map((entry) => ({
      id: entry.key,
      operationalCode: entry.operationalCode,
      active: entry.active,
    })),
    products: template.products.map((entry) => ({
      id: entry.key,
      name: entry.name,
      code: entry.code,
      resourceGroupId: entry.resourceGroupKey,
      gateId: entry.gateKey,
      referenceCapacity: entry.referenceCapacity,
      referenceDurationMinutes: entry.referenceDurationMinutes,
    })),
  };
}

function createPlannedOperations(
  exported: SimulationPlanExport | null,
): SimulationPlannedOperation[] {
  return (exported?.plannedOperations ?? []).map((entry) => ({
    key: entry.key,
    scopeType: entry.scopeType,
    scopeId: entry.scopeKey,
    kind: entry.kind,
    effectMode: entry.effectMode,
    durationMultiplierPercent: entry.durationMultiplierPercent,
    startMode: entry.startMode,
    earliestStartAt: entry.earliestStartAt,
    latestStartAt: entry.latestStartAt,
    afterRotationId: null,
    unresolvedAfterCurrentRotation: entry.afterCurrentRotation,
    minimumDurationMinutes: entry.minimumDurationMinutes,
    typicalDurationMinutes: entry.typicalDurationMinutes,
    maximumDurationMinutes: entry.maximumDurationMinutes,
    publicNote: entry.publicNote,
  }));
}

function createRecurringRules(
  exported: SimulationPlanExport | null,
): SimulationRecurringOperationalRule[] {
  return (exported?.recurringRules ?? []).map((entry) => ({
    ...entry,
    scopeId: entry.scopeKey,
  }));
}

function buildPreview(
  template: MasterDataTemplate,
  baseConfig: SimulationConfig,
  exported: SimulationPlanExport | null,
): SimulationPlanImportPreview {
  const operationalModel = createOperationalModel(template);
  const schedule = exported?.schedule ?? baseConfig.schedule;
  const activePilots = operationalModel.pilots.filter((entry) => entry.active).length;
  const productCount = Math.max(1, operationalModel.products.length);
  const demandDuration = salesDurationMinutes(schedule);
  const demandByProduct = Object.fromEntries(
    operationalModel.products.map((product) => [
      product.id,
      demandForProfile("TWO_WAVES", demandDuration, 18 / productCount),
    ]),
  );
  const plannedOperations = createPlannedOperations(exported);
  const recurringRules = createRecurringRules(exported);
  const aircraftTypes = new Set(operationalModel.aircraft.map((entry) => entry.aircraftType));
  const representativeProduct = operationalModel.products[0];
  const firstDemand = representativeProduct ? demandByProduct[representativeProduct.id] : undefined;
  const config: SimulationConfig = {
    ...structuredClone(baseConfig),
    preset: "NORMAL",
    schedule: structuredClone(schedule),
    adminParameters: {
      ...structuredClone(baseConfig.adminParameters),
      plannedBoardingMinutes: template.eventParameters.plannedBoardingMinutes,
      plannedDeboardingMinutes: template.eventParameters.plannedDeboardingMinutes,
      plannedBufferMinutes: template.eventParameters.plannedBufferMinutes,
      productReferenceDurationMinutes:
        representativeProduct?.referenceDurationMinutes ??
        baseConfig.adminParameters.productReferenceDurationMinutes,
      eventAutomaticPrecallEnabled: template.eventParameters.automaticPrecallEnabled,
      resourceGroupAutomaticPrecallEnabled: operationalModel.resourceGroups.every(
        (entry) => entry.automaticPrecallEnabled,
      ),
      aircraftCount: operationalModel.aircraft.length,
      aircraftType:
        aircraftTypes.size === 1
          ? (operationalModel.aircraft[0]?.aircraftType ?? baseConfig.adminParameters.aircraftType)
          : `${aircraftTypes.size} Flugzeugtypen`,
      passengerSeats: Math.max(1, ...operationalModel.aircraft.map((entry) => entry.capacity)),
      activePilotCount: activePilots,
    },
    realityModel: {
      ...structuredClone(baseConfig.realityModel),
      demand: firstDemand
        ? structuredClone(firstDemand)
        : demandForProfile("TWO_WAVES", demandDuration),
    },
    operationalModel,
    demandByProduct,
    plannedOperations,
    recurringRules,
  };
  const unresolvedAfterCurrentRotation = plannedOperations.filter(
    (entry) => entry.unresolvedAfterCurrentRotation,
  ).length;
  const warnings: string[] = [];
  if (!exported) {
    warnings.push(
      "Das Stammdaten-Template enthält keinen Tageszeitplan und keine geplanten Unterbrechungen. Dafür bleiben die aktuellen Simulatorwerte erhalten.",
    );
  }
  if (unresolvedAfterCurrentRotation > 0) {
    warnings.push(
      `${unresolvedAfterCurrentRotation} Planeintrag/Planeinträge beginnen „nach aktuellem Umlauf“. Sie müssen vor dem Lauf ausgeschlossen oder einem simulierten Umlauf zugeordnet werden.`,
    );
  }
  const unassignedAircraft = operationalModel.aircraft.filter(
    (entry) => !entry.resourceGroupId,
  ).length;
  if (unassignedAircraft > 0) {
    warnings.push(
      `${unassignedAircraft} Flugzeug/Flugzeuge besitzen keine Ressourcengruppenzuordnung.`,
    );
  }
  if (activePilots === 0) {
    warnings.push("Es ist kein aktiver Pilotencode enthalten; es können keine Umläufe starten.");
  }
  return {
    sourceName: template.source.name,
    format: exported ? "rundflug-simulation-plan" : "rundflug-master-data-template",
    config,
    counts: {
      gates: operationalModel.gates.length,
      resourceGroups: operationalModel.resourceGroups.length,
      aircraft: operationalModel.aircraft.length,
      pilots: activePilots,
      products: operationalModel.products.length,
      plannedOperations: plannedOperations.length,
      recurringRules: recurringRules.length,
      unresolvedAfterCurrentRotation,
    },
    warnings,
  };
}

export function parseSimulationPlanImport(
  text: string,
  baseConfig: SimulationConfig,
): SimulationPlanImportPreview {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SimulationPlanImportError("Die Datei enthält kein gültiges JSON.");
  }
  const simulationPlan = simulationPlanExportSchema.safeParse(raw);
  if (simulationPlan.success) {
    return buildPreview(simulationPlan.data.masterData, baseConfig, simulationPlan.data);
  }
  const masterData = masterDataTemplateSchema.safeParse(raw);
  if (masterData.success) {
    return buildPreview(masterData.data, baseConfig, null);
  }
  const firstIssue =
    simulationPlan.error.issues[0]?.message ??
    masterData.error.issues[0]?.message ??
    "Unbekanntes Dateiformat.";
  throw new SimulationPlanImportError(
    `Die Datei ist weder ein Simulationsplan noch ein gültiges Stammdaten-Template: ${firstIssue}`,
  );
}

export function excludeUnresolvedPlannedOperations(
  preview: SimulationPlanImportPreview,
): SimulationConfig {
  return {
    ...structuredClone(preview.config),
    plannedOperations: preview.config.plannedOperations.filter(
      (entry) => !entry.unresolvedAfterCurrentRotation,
    ),
  };
}
