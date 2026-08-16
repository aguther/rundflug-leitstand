import {
  executeOperationsReadQueryPlan,
  type OperationsReadQueryResult,
} from "./operations-read-query-plan";

export interface OperationsReadModelGroups {
  commercial: Pick<
    OperationsReadQueryResult,
    "products" | "aircraftProductTurnaroundOverrideRows" | "queueGroupRows"
  >;
  operations: Pick<
    OperationsReadQueryResult,
    "rotations" | "dispatchLeaseRows" | "durationRows" | "metricsRow"
  >;
  resources: Pick<
    OperationsReadQueryResult,
    "aircraftRows" | "fleetRows" | "pilotRows" | "assistClaims"
  >;
  planning: Pick<
    OperationsReadQueryResult,
    "gatesRows" | "resourceGroupRows" | "plannedOperationRows" | "recurringRuleRows"
  >;
}

export type OperationsReadModels = OperationsReadQueryResult & {
  groups: OperationsReadModelGroups;
  eventId: string;
  projectionReadAt: string;
};

export async function loadOperationsReadModels(
  database: D1Database,
  eventId: string,
  projectionReadAt: string,
): Promise<OperationsReadModels> {
  const result = await executeOperationsReadQueryPlan(database, eventId, projectionReadAt);
  return {
    ...result,
    eventId,
    projectionReadAt,
    groups: {
      commercial: {
        products: result.products,
        aircraftProductTurnaroundOverrideRows: result.aircraftProductTurnaroundOverrideRows,
        queueGroupRows: result.queueGroupRows,
      },
      operations: {
        rotations: result.rotations,
        dispatchLeaseRows: result.dispatchLeaseRows,
        durationRows: result.durationRows,
        metricsRow: result.metricsRow,
      },
      resources: {
        aircraftRows: result.aircraftRows,
        fleetRows: result.fleetRows,
        pilotRows: result.pilotRows,
        assistClaims: result.assistClaims,
      },
      planning: {
        gatesRows: result.gatesRows,
        resourceGroupRows: result.resourceGroupRows,
        plannedOperationRows: result.plannedOperationRows,
        recurringRuleRows: result.recurringRuleRows,
      },
    },
  };
}
