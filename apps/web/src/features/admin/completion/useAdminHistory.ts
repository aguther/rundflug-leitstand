import type { AuditHistory, ForecastHistory, OperationalHistory } from "@rundflug/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminArea, AdminEventStep } from "../../../admin-ux";
import { getAuditHistory, getForecastHistory, getOperationalHistory } from "../../../api";
import { eventLocalDateTimeToIso } from "../../../event-time";
import { ADMIN_DEVICE_ID, deviceTokenFor, EVENT_ID } from "../../../operation-workspace";
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
  timeZone?: string | undefined;
}

export function useAdminHistory({
  activeArea,
  activeEventStep,
  onError,
  timeZone = "Europe/Berlin",
}: UseAdminHistoryOptions) {
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
        await getAuditHistory(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID), {
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
  ]);

  const refreshDetailedHistory = useCallback(
    async (requestedOffset: number) => {
      try {
        const shared = {
          ...(filters.since ? { since: eventLocalDateTimeToIso(filters.since, timeZone) } : {}),
          ...(filters.until ? { until: eventLocalDateTimeToIso(filters.until, timeZone) } : {}),
          ...(filters.aircraftId ? { aircraftId: filters.aircraftId } : {}),
          ...(filters.pilotId ? { pilotId: filters.pilotId } : {}),
          ...(filters.rotationId ? { rotationId: filters.rotationId.trim() } : {}),
          limit: 50,
          offset: requestedOffset,
        };
        if (view === "FORECASTS") {
          setForecastHistory(
            await getForecastHistory(
              EVENT_ID,
              ADMIN_DEVICE_ID,
              deviceTokenFor(ADMIN_DEVICE_ID),
              shared,
            ),
          );
        } else if (view === "OPERATIONS") {
          setOperationalHistory(
            await getOperationalHistory(
              EVENT_ID,
              ADMIN_DEVICE_ID,
              deviceTokenFor(ADMIN_DEVICE_ID),
              {
                ...shared,
                ...(filters.ticketStatus
                  ? {
                      ticketStatus:
                        filters.ticketStatus as OperationalHistory["entries"][number]["ticketStatus"],
                    }
                  : {}),
                ...(filters.productId ? { productId: filters.productId } : {}),
                ...(filters.resourceGroupId ? { resourceGroupId: filters.resourceGroupId } : {}),
                ...(filters.communicationNumber
                  ? { communicationNumber: Number(filters.communicationNumber) }
                  : {}),
                ...(filters.ticketId ? { ticketId: filters.ticketId.trim() } : {}),
                ...(filters.ticketGroupId ? { ticketGroupId: filters.ticketGroupId.trim() } : {}),
              },
            ),
          );
        }
        setOffset(requestedOffset);
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Verlauf nicht verfügbar.");
      }
    },
    [filters, onError, timeZone, view],
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
