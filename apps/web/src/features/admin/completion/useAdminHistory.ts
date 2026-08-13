import type { AuditHistory, ForecastHistory, OperationalHistory } from "@rundflug/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminArea, AdminEventStep } from "../../../admin-ux";
import { getAuditHistory, getForecastHistory, getOperationalHistory } from "../../../api";
import { eventLocalDateTimeToIso } from "../../../event-time";
import { useAdminOperationIdentity } from "../../operations/operation-identity";
import type {
  AdminHistoryFilterKey,
  AdminHistoryFilters,
  AdminHistoryView,
} from "./CompletionHistoryPanel";

const emptyFilters: AdminHistoryFilters = {
  aggregateId: "",
  aggregateType: "",
  aircraftId: "",
  communicationNumber: "",
  eventType: "",
  pilotId: "",
  productId: "",
  resourceGroupId: "",
  rotationId: "",
  since: "",
  textSearch: "",
  ticketGroupId: "",
  ticketId: "",
  ticketStatus: "",
  until: "",
};

interface UseAdminHistoryOptions {
  activeArea: AdminArea;
  activeEventStep: AdminEventStep;
  onError: (message: string) => void;
  timeZone?: string;
}

type ForecastHistoryFilters = NonNullable<Parameters<typeof getForecastHistory>[3]>;
type OperationalHistoryFilters = NonNullable<Parameters<typeof getOperationalHistory>[3]>;

function sharedHistoryFilters(
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

function operationalHistoryFilters(
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

export function useAdminHistory({
  activeArea,
  activeEventStep,
  onError,
  timeZone = "Europe/Berlin",
}: UseAdminHistoryOptions) {
  const {
    eventId: EVENT_ID,
    deviceId: ADMIN_DEVICE_ID,
    deviceToken: ADMIN_DEVICE_TOKEN,
  } = useAdminOperationIdentity();
  const [auditHistory, setAuditHistory] = useState<AuditHistory>({ entries: [] });
  const [view, setView] = useState<AdminHistoryView>("OPERATIONS");
  const [operationalHistory, setOperationalHistory] = useState<OperationalHistory>({
    entries: [],
    total: 0,
    limit: 50,
    offset: 0,
  });
  const [forecastHistory, setForecastHistory] = useState<ForecastHistory>({
    entries: [],
    total: 0,
    limit: 50,
    offset: 0,
  });
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<AdminHistoryFilters>(emptyFilters);
  const filtersByViewRef = useRef<Record<AdminHistoryView, AdminHistoryFilters | null>>({
    OPERATIONS: null,
    FORECASTS: null,
    AUDIT: null,
  });

  const refreshAuditHistory = useCallback(async () => {
    try {
      setAuditHistory(
        await getAuditHistory(EVENT_ID, ADMIN_DEVICE_ID, ADMIN_DEVICE_TOKEN, {
          eventType: filters.eventType,
          aggregateType: filters.aggregateType,
          aggregateId: filters.aggregateId,
          ...(filters.since ? { since: eventLocalDateTimeToIso(filters.since, timeZone) } : {}),
          ...(filters.until ? { until: eventLocalDateTimeToIso(filters.until, timeZone) } : {}),
        }),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Historie nicht verfügbar.");
    }
  }, [
    filters.aggregateId,
    filters.aggregateType,
    filters.eventType,
    filters.since,
    filters.until,
    onError,
    timeZone,
    ADMIN_DEVICE_TOKEN,
    ADMIN_DEVICE_ID,
    EVENT_ID,
  ]);

  const refreshDetailedHistory = useCallback(
    async (requestedOffset: number) => {
      try {
        const shared = sharedHistoryFilters(filters, timeZone, requestedOffset);
        if (view === "FORECASTS") {
          setForecastHistory(
            await getForecastHistory(EVENT_ID, ADMIN_DEVICE_ID, ADMIN_DEVICE_TOKEN, shared),
          );
        } else if (view === "OPERATIONS") {
          setOperationalHistory(
            await getOperationalHistory(
              EVENT_ID,
              ADMIN_DEVICE_ID,
              ADMIN_DEVICE_TOKEN,
              operationalHistoryFilters(filters, shared),
            ),
          );
        }
        setOffset(requestedOffset);
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Verlauf nicht verfügbar.");
      }
    },
    [filters, onError, timeZone, view, ADMIN_DEVICE_TOKEN, EVENT_ID, ADMIN_DEVICE_ID],
  );

  useEffect(() => {
    void refreshAuditHistory();
    if (view !== "AUDIT") void refreshDetailedHistory(0);
  }, [refreshAuditHistory, refreshDetailedHistory, view]);

  useEffect(() => {
    if (activeArea === "events" && activeEventStep === "completion" && view === "AUDIT") return;
    if (activeArea !== "events" && view === "AUDIT") setView("OPERATIONS");
  }, [activeArea, activeEventStep, view]);

  const changeView = useCallback(
    (nextView: AdminHistoryView) => {
      filtersByViewRef.current[view] = filters;
      setFilters(filtersByViewRef.current[nextView] ?? emptyFilters);
      setOffset(0);
      setView(nextView);
    },
    [filters, view],
  );

  const changeFilter = useCallback(
    (key: AdminHistoryFilterKey, value: string, resetOffset = false) => {
      setFilters((current) => ({ ...current, [key]: value }));
      if (resetOffset) setOffset(0);
    },
    [],
  );

  const resetFilters = useCallback(() => {
    setFilters(emptyFilters);
    setOffset(0);
  }, []);

  const applyFilters = useCallback(() => {
    setOffset(0);
    if (view === "AUDIT") void refreshAuditHistory();
    else void refreshDetailedHistory(0);
  }, [refreshAuditHistory, refreshDetailedHistory, view]);

  return {
    applyFilters,
    auditHistory,
    changeFilter,
    changeView,
    filters,
    forecastHistory,
    offset,
    operationalHistory,
    refreshAuditHistory,
    refreshDetailedHistory,
    resetFilters,
    view,
  };
}
