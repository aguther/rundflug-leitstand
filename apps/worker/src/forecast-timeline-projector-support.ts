import type { ForecastTimelineLoader } from "./forecast-timeline-loader";

type ForecastTimelineData = Awaited<ReturnType<ForecastTimelineLoader["load"]>>;
type AvailabilityWindow = { lowerAt: string; expectedAt: string; upperAt: string };

export function availabilityWindow(
  value: string | null,
  immediatelyAvailable: boolean,
  now: Date,
): AvailabilityWindow | null {
  const nowIso = now.toISOString();
  if (immediatelyAvailable) {
    return { lowerAt: nowIso, expectedAt: nowIso, upperAt: nowIso };
  }
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const expected = Math.max(now.getTime(), Date.parse(value));
  return {
    lowerAt: new Date(Math.max(now.getTime(), expected - 5 * 60_000)).toISOString(),
    expectedAt: new Date(expected).toISOString(),
    upperAt: new Date(expected + 5 * 60_000).toISOString(),
  };
}

export function precallPublicStatus(
  status: string | null,
): "COME_TO_FLIGHT_LINE" | "PREPARE" | "WAITING" {
  if (status === "GO_TO_GATE") return "COME_TO_FLIGHT_LINE";
  return status === "PREPARE" ? "PREPARE" : "WAITING";
}

export function stringArray(value: string): string[] {
  try {
    return (JSON.parse(value) as unknown[]).filter(
      (entry): entry is string => typeof entry === "string",
    );
  } catch {
    return [];
  }
}

export function blockedResourceAvailability(
  rows: ForecastTimelineData["activeBlockRows"]["results"],
  resourceGroupId: string,
  eventId: string,
  now: Date,
): AvailabilityWindow | null | undefined {
  const effective = rows.filter(
    (block) =>
      (block.scope_type === "EVENT" && block.scope_id === eventId) ||
      (block.scope_type === "RESOURCE_GROUP" && block.scope_id === resourceGroupId),
  );
  if (effective.length === 0) return undefined;
  if (effective.some((block) => block.expected_review_at === null)) return null;
  const latestReviewAt = effective.reduce<string | null>(
    (latest, block) =>
      !latest || Date.parse(block.expected_review_at ?? "") > Date.parse(latest)
        ? block.expected_review_at
        : latest,
    null,
  );
  return availabilityWindow(latestReviewAt, false, now);
}

export function productServiceDeficits(
  rows: ForecastTimelineData["rotationRows"]["results"],
  now: Date,
): Map<string, number> {
  const deficits = new Map<string, number>();
  for (const rotation of rows.filter((entry) => entry.status === "DRAFT")) {
    if (!rotation.product_id) continue;
    const waitingMinutes = Math.max(
      0,
      (now.getTime() - Date.parse(rotation.sold_at ?? rotation.created_at)) / 60_000,
    );
    const deficit =
      (waitingMinutes * Math.max(1, rotation.ticket_count)) /
      Math.max(1, rotation.reference_duration_minutes);
    deficits.set(rotation.product_id, (deficits.get(rotation.product_id) ?? 0) + deficit);
  }
  return deficits;
}

export function dispatchPredecessors(
  rows: ForecastTimelineData["rotationRows"]["results"],
): Map<string, Set<string>> {
  const segmentsByBookingGroup = new Map<string, typeof rows>();
  for (const rotation of rows) {
    if (rotation.status !== "DRAFT") continue;
    const bookingGroupIds = JSON.parse(rotation.current_group_ids_json) as string[];
    for (const bookingGroupId of bookingGroupIds) {
      const segments = segmentsByBookingGroup.get(bookingGroupId) ?? [];
      segments.push(rotation);
      segmentsByBookingGroup.set(bookingGroupId, segments);
    }
  }
  const predecessorsByMember = new Map<string, Set<string>>();
  for (const segments of segmentsByBookingGroup.values()) {
    segments.sort(
      (left, right) =>
        left.segment_order - right.segment_order ||
        left.created_at.localeCompare(right.created_at) ||
        left.id.localeCompare(right.id),
    );
    for (let index = 1; index < segments.length; index += 1) {
      const current = segments[index];
      const predecessor = segments[index - 1];
      if (!current || !predecessor) continue;
      const memberPredecessors = predecessorsByMember.get(current.id) ?? new Set();
      memberPredecessors.add(predecessor.id);
      predecessorsByMember.set(current.id, memberPredecessors);
    }
  }
  return predecessorsByMember;
}
