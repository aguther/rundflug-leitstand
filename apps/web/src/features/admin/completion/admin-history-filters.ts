import type { OperationalHistory } from "@rundflug/contracts";
import type { getForecastHistory, getOperationalHistory } from "../../../api";
import { eventLocalDateTimeToIso } from "../../../event-time";
import type { AdminHistoryFilters } from "./CompletionHistoryPanel";

type ForecastHistoryFilters = NonNullable<Parameters<typeof getForecastHistory>[3]>;
type OperationalHistoryFilters = NonNullable<Parameters<typeof getOperationalHistory>[3]>;

export function sharedHistoryFilters(
  filters: AdminHistoryFilters,
  timeZone: string,
  offset: number,
): ForecastHistoryFilters {
  const query: ForecastHistoryFilters = { limit: 50, offset };
  if (filters.since) query.since = eventLocalDateTimeToIso(filters.since, timeZone);
  if (filters.until) query.until = eventLocalDateTimeToIso(filters.until, timeZone);
  if (filters.aircraftId) query.aircraftId = filters.aircraftId;
  if (filters.pilotId) query.pilotId = filters.pilotId;
  if (filters.rotationId) query.rotationId = filters.rotationId.trim();
  return query;
}

export function operationalHistoryFilters(
  filters: AdminHistoryFilters,
  shared: ForecastHistoryFilters,
): OperationalHistoryFilters {
  const query: OperationalHistoryFilters = { ...shared };
  if (filters.ticketStatus) {
    query.ticketStatus =
      filters.ticketStatus as OperationalHistory["entries"][number]["ticketStatus"];
  }
  if (filters.productId) query.productId = filters.productId;
  if (filters.resourceGroupId) query.resourceGroupId = filters.resourceGroupId;
  if (filters.communicationNumber) query.communicationNumber = Number(filters.communicationNumber);
  if (filters.ticketId) query.ticketId = filters.ticketId.trim();
  if (filters.ticketGroupId) query.ticketGroupId = filters.ticketGroupId.trim();
  return query;
}
