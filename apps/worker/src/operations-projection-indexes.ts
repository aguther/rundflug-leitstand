import type { loadOperationsReadModels } from "./operations-read-service";

type OperationsReadModels = Awaited<ReturnType<typeof loadOperationsReadModels>>;

export const OPERATIONS_PROJECTION_MAXIMUM_MILLISECONDS = 500;

export function compositeIndexKey(...parts: Array<string | null>): string {
  return parts.map((part) => part ?? "").join("\u0000");
}

export function indexRowsBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T> {
  return new Map(rows.map((row) => [keyOf(row), row]));
}

export function groupRowsBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export function groupRowsByMany<T>(
  rows: readonly T[],
  keysOf: (row: T) => readonly string[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    for (const key of new Set(keysOf(row))) {
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
  }
  return groups;
}

export function createOperationsProjectionIndexes(
  readModels: OperationsReadModels,
  forecastReferenceMs: number,
) {
  const {
    products,
    aircraftProductTurnaroundOverrideRows,
    rotations,
    aircraftRows,
    fleetRows,
    pilotRows,
    resourceGroupRows,
    plannedOperationRows,
    recurringRuleRows,
  } = readModels;
  const productsById = indexRowsBy(products.results, (product) => product.id);
  const productsByCode = indexRowsBy(products.results, (product) => product.code);
  const aircraftRowsByResourceGroupId = groupRowsBy(
    aircraftRows.results,
    (aircraft) => aircraft.resource_group_id,
  );
  const fleetById = indexRowsBy(fleetRows.results, (aircraft) => aircraft.id);
  const fleetByResourceGroupId = groupRowsBy(
    fleetRows.results,
    (aircraft) => aircraft.resource_group_id ?? "",
  );
  const pilotsById = indexRowsBy(pilotRows.results, (pilot) => pilot.id);
  const rotationsById = indexRowsBy(rotations.results, (rotation) => rotation.id);
  const rotationsByResourceGroupId = groupRowsBy(
    rotations.results,
    (rotation) => rotation.resource_group_id,
  );
  const rotationsByResourceGroupAircraftId = groupRowsByMany(rotations.results, (rotation) =>
    [rotation.aircraft_id, rotation.forecast_assumed_aircraft_id]
      .filter((aircraftId): aircraftId is string => aircraftId !== null)
      .map((aircraftId) => compositeIndexKey(rotation.resource_group_id, aircraftId)),
  );
  const resourceGroupsById = indexRowsBy(resourceGroupRows.results, (group) => group.id);
  const turnaroundOverridesByAircraftProduct = indexRowsBy(
    aircraftProductTurnaroundOverrideRows.results,
    (override) => compositeIndexKey(override.aircraft_id, override.product_id),
  );
  const activePlans = plannedOperationRows.results.filter(
    (plan) => plan.status !== "CLEARED" && plan.status !== "CANCELED",
  );
  const activePlanOrderById = new Map(activePlans.map((plan, index) => [plan.id, index]));
  const planScopeIndexKey = (scopeType: string, scopeId: string | null) =>
    compositeIndexKey(scopeType, scopeType === "EVENT" ? null : scopeId);
  const activePlansByScope = groupRowsBy(activePlans, (plan) =>
    planScopeIndexKey(plan.scope_type, plan.scope_id),
  );
  const activeRecurringRules = recurringRuleRows.results.filter((rule) => rule.status === "ACTIVE");
  const activeRecurringRuleOrderById = new Map(
    activeRecurringRules.map((rule, index) => [rule.id, index]),
  );
  const activeRecurringRulesByScope = groupRowsBy(activeRecurringRules, (rule) =>
    compositeIndexKey(rule.scope_type, rule.scope_id),
  );
  const firstQueuedRotationByResourceGroupId = new Map<
    string,
    (typeof rotations.results)[number]
  >();
  for (const rotation of rotations.results) {
    if (
      rotation.status === "DRAFT" &&
      rotation.prediction_lower_minutes !== null &&
      rotation.prediction_upper_minutes !== null &&
      !firstQueuedRotationByResourceGroupId.has(rotation.resource_group_id)
    ) {
      firstQueuedRotationByResourceGroupId.set(rotation.resource_group_id, rotation);
    }
  }
  const availablePilotsByResourceGroupId = new Map<
    string,
    Array<{ id: string; availableMinutes: number }>
  >();
  const availablePilotsFor = (resourceGroupId: string) => {
    const cached = availablePilotsByResourceGroupId.get(resourceGroupId);
    if (cached) return cached;
    const availablePilots = pilotRows.results
      .flatMap((pilot) => {
        if (pilot.active !== 1) return [];
        const activeRotation = pilot.current_rotation_id
          ? rotationsById.get(pilot.current_rotation_id)
          : undefined;
        const rotationInResourceGroup =
          activeRotation?.resource_group_id === resourceGroupId ? activeRotation : undefined;
        const availableAt = rotationInResourceGroup?.predicted_completion_at
          ? Date.parse(rotationInResourceGroup.predicted_completion_at)
          : pilot.paused === 1
            ? pilot.pause_expected_review_at
              ? Date.parse(pilot.pause_expected_review_at)
              : Number.NaN
            : forecastReferenceMs;
        if (!Number.isFinite(availableAt)) return [];
        return [
          {
            id: pilot.id,
            availableMinutes: Math.max(0, (availableAt - forecastReferenceMs) / 60_000),
          },
        ];
      })
      .sort(
        (left, right) =>
          left.availableMinutes - right.availableMinutes || left.id.localeCompare(right.id),
      );
    availablePilotsByResourceGroupId.set(resourceGroupId, availablePilots);
    return availablePilots;
  };

  return {
    productsById,
    productsByCode,
    aircraftRowsByResourceGroupId,
    fleetById,
    fleetByResourceGroupId,
    pilotsById,
    rotationsById,
    rotationsByResourceGroupId,
    rotationsByResourceGroupAircraftId,
    resourceGroupsById,
    turnaroundOverridesByAircraftProduct,
    activePlanOrderById,
    planScopeIndexKey,
    activePlansByScope,
    activeRecurringRuleOrderById,
    activeRecurringRulesByScope,
    firstQueuedRotationByResourceGroupId,
    availablePilotsFor,
  };
}
