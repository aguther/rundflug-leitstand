import type { TicketSearchResult } from "@rundflug/contracts";
import { useCallback, useRef, useState } from "react";
import { searchTickets } from "../../api";
import {
  type TicketListTab,
  ticketMatchesListStatus,
  ticketSearchRequest,
} from "./CashierViewPresentation";
import { mergeRevalidatedTicketGroups, ticketGroupIdBatches } from "./cashier-ticket-status-sync";

interface LoadTicketListOptions {
  append?: boolean;
  preserveLoaded?: boolean;
  status?: TicketListTab;
  query?: string;
  reportError?: boolean;
  soldByOperatorAccountId?: string;
}

export function useCashierTicketListData({
  clearReceipt,
  currentAccountId,
  deviceId,
  deviceToken,
  effectiveAccountFilter,
  eventId,
  query,
  serverConfirmed,
  setMessage,
  status,
}: {
  clearReceipt: () => void;
  currentAccountId: string | undefined;
  deviceId: string;
  deviceToken: string;
  effectiveAccountFilter: string;
  eventId: string;
  query: string;
  serverConfirmed: boolean;
  setMessage: (message: string | null) => void;
  status: TicketListTab;
}) {
  const [results, setResults] = useState<TicketSearchResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTicketGroupId, setSelectedTicketGroupId] = useState<string | null>(null);
  const requestRef = useRef(0);
  const statusRefreshRef = useRef<{ controller: AbortController | null; id: number }>({
    controller: null,
    id: 0,
  });
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const resultCountRef = useRef(0);
  const nextCursorRef = useRef<string | null>(null);
  const resultsRef = useRef<TicketSearchResult[]>([]);
  const lastBoardVersionRef = useRef<number | null>(null);

  const cancelStatusRefresh = useCallback(() => {
    statusRefreshRef.current.controller?.abort();
    statusRefreshRef.current = {
      controller: null,
      id: statusRefreshRef.current.id + 1,
    };
  }, []);

  const reset = useCallback(() => {
    cancelStatusRefresh();
    requestRef.current += 1;
    resultCountRef.current = 0;
    nextCursorRef.current = null;
    resultsRef.current = [];
    setResults([]);
    setNextCursor(null);
    setSelectedTicketGroupId(null);
    clearReceipt();
  }, [cancelStatusRefresh, clearReceipt]);

  const load = useCallback(
    async ({
      append = false,
      preserveLoaded = false,
      status: requestedStatus = status,
      query: requestedQuery = query,
      reportError = true,
      soldByOperatorAccountId = effectiveAccountFilter || undefined,
    }: LoadTicketListOptions = {}) => {
      if (!serverConfirmed) return;
      cancelStatusRefresh();
      const requestId = ++requestRef.current;
      setLoading(true);
      try {
        const response = await searchTickets(
          eventId,
          deviceId,
          deviceToken,
          ticketSearchRequest({
            query: requestedQuery,
            status: requestedStatus,
            preserveLoaded,
            loadedCount: resultCountRef.current,
            append,
            nextCursor: nextCursorRef.current,
            ...(soldByOperatorAccountId ? { soldByOperatorAccountId } : {}),
          }),
        );
        if (requestId !== requestRef.current) return;
        setResults((current) => {
          let nextResults: TicketSearchResult[];
          if (append) {
            const known = new Set(current.map((entry) => entry.ticketGroupId));
            nextResults = [
              ...current,
              ...response.results.filter((entry) => !known.has(entry.ticketGroupId)),
            ];
          } else if (!preserveLoaded) {
            nextResults = response.results;
          } else {
            const updatedIds = new Set(response.results.map((entry) => entry.ticketGroupId));
            nextResults = [
              ...response.results,
              ...current.filter(
                (entry) =>
                  !updatedIds.has(entry.ticketGroupId) &&
                  ticketMatchesListStatus(entry, requestedStatus),
              ),
            ];
          }
          resultCountRef.current = nextResults.length;
          resultsRef.current = nextResults;
          return nextResults;
        });
        nextCursorRef.current = response.nextCursor;
        setNextCursor(response.nextCursor);
        const firstResult = response.results[0];
        if (!append && firstResult) {
          setSelectedTicketGroupId((current) => current ?? firstResult.ticketGroupId);
        }
      } catch (reason) {
        if (reportError && requestId === requestRef.current) {
          setMessage(reason instanceof Error ? reason.message : "Ticketliste nicht verfügbar.");
        }
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [
      cancelStatusRefresh,
      deviceId,
      deviceToken,
      effectiveAccountFilter,
      eventId,
      query,
      serverConfirmed,
      setMessage,
      status,
    ],
  );

  const mergeById = useCallback(
    async (ticketGroupIds: string[]) => {
      if (!serverConfirmed || ticketGroupIds.length === 0) return;
      const response = await searchTickets(eventId, deviceId, deviceToken, {
        q: "",
        status: "ACTIVE",
        limit: Math.min(ticketGroupIds.length, 50),
        ticketGroupIds,
        ...(effectiveAccountFilter ? { soldByOperatorAccountId: effectiveAccountFilter } : {}),
      });
      const soldTicketMustMatchFilter =
        !effectiveAccountFilter || effectiveAccountFilter === currentAccountId;
      if (soldTicketMustMatchFilter && response.results.length !== ticketGroupIds.length) {
        throw new Error(
          "Der bestätigte Verkauf ist noch nicht vollständig in der Kassenliste sichtbar.",
        );
      }
      setResults((current) => {
        const updatedIds = new Set(response.results.map((entry) => entry.ticketGroupId));
        const nextResults = [
          ...response.results,
          ...current.filter((entry) => !updatedIds.has(entry.ticketGroupId)),
        ];
        resultCountRef.current = nextResults.length;
        resultsRef.current = nextResults;
        return nextResults;
      });
    },
    [currentAccountId, deviceId, deviceToken, effectiveAccountFilter, eventId, serverConfirmed],
  );

  const revalidate = useCallback(async () => {
    if (!serverConfirmed) return;
    const ticketGroupIds = resultsRef.current.map((result) => result.ticketGroupId);
    if (ticketGroupIds.length === 0) return;
    statusRefreshRef.current.controller?.abort();
    const controller = new AbortController();
    const refreshId = statusRefreshRef.current.id + 1;
    const listRequestId = requestRef.current;
    statusRefreshRef.current = { controller, id: refreshId };
    try {
      const responses = await Promise.all(
        ticketGroupIdBatches(ticketGroupIds).map((batch) =>
          searchTickets(
            eventId,
            deviceId,
            deviceToken,
            {
              q: "",
              status: "ACTIVE",
              limit: batch.length,
              ticketGroupIds: batch,
              ...(effectiveAccountFilter
                ? { soldByOperatorAccountId: effectiveAccountFilter }
                : {}),
            },
            { signal: controller.signal },
          ),
        ),
      );
      if (
        controller.signal.aborted ||
        refreshId !== statusRefreshRef.current.id ||
        listRequestId !== requestRef.current
      ) {
        return;
      }
      const refreshed = responses.flatMap((response) => response.results);
      setResults((current) => {
        const nextResults = mergeRevalidatedTicketGroups(current, refreshed);
        resultCountRef.current = nextResults.length;
        resultsRef.current = nextResults;
        return nextResults;
      });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      // The next board event, focus refresh, or manual refresh retries the projection quietly.
    } finally {
      if (refreshId === statusRefreshRef.current.id) {
        statusRefreshRef.current = { controller: null, id: refreshId };
      }
    }
  }, [deviceId, deviceToken, effectiveAccountFilter, eventId, serverConfirmed]);

  return {
    cancelStatusRefresh,
    lastBoardVersionRef,
    load,
    loading,
    mergeById,
    nextCursor,
    reset,
    results,
    revalidate,
    selectedTicketGroupId,
    sentinelRef,
    setSelectedTicketGroupId,
  };
}
