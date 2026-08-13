export function plannedTargetExists(
  scopeType: "EVENT" | "RESOURCE_GROUP" | "AIRCRAFT" | "PILOT",
  scopeId: string,
  targets: Readonly<{
    resourceGroups: ReadonlySet<string>;
    aircraft: ReadonlySet<string>;
    pilots: ReadonlySet<string>;
  }>,
): boolean {
  if (scopeType === "EVENT") return scopeId === "event";
  if (scopeType === "RESOURCE_GROUP") return targets.resourceGroups.has(scopeId);
  if (scopeType === "AIRCRAFT") return targets.aircraft.has(scopeId);
  return targets.pilots.has(scopeId);
}
