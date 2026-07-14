import type { OperationBoard } from "@rundflug/contracts";

type Rotation = OperationBoard["rotations"][number];

const POST_DEPARTURE_STATUSES = new Set<Rotation["status"]>(["IN_FLIGHT", "LANDED", "COMPLETED"]);

export type ManifestCorrectionCandidate = {
  ticketGroupId: string;
  sourceRotations: Rotation[];
  label: string;
};

export function manifestCorrectionCandidates(rotations: Rotation[]): ManifestCorrectionCandidate[] {
  const grouped = new Map<string, Rotation[]>();
  for (const rotation of rotations) {
    const entries = grouped.get(rotation.ticketGroupId) ?? [];
    entries.push(rotation);
    grouped.set(rotation.ticketGroupId, entries);
  }

  return [...grouped.entries()]
    .filter(([, entries]) => entries.some((entry) => POST_DEPARTURE_STATUSES.has(entry.status)))
    .map(([ticketGroupId, entries]) => ({
      ticketGroupId,
      sourceRotations: entries,
      label: entries.map((entry) => entry.communicationLabel).join(" + "),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "de"));
}

export function manifestCorrectionTargets(
  rotations: Rotation[],
  candidate: ManifestCorrectionCandidate | undefined,
): Rotation[] {
  const sourceIds = new Set(candidate?.sourceRotations.map((entry) => entry.id) ?? []);
  return rotations
    .filter(
      (rotation) => POST_DEPARTURE_STATUSES.has(rotation.status) && !sourceIds.has(rotation.id),
    )
    .sort((left, right) => left.communicationNumber - right.communicationNumber);
}
