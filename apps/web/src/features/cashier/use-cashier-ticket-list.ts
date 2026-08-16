import type { OperationBoard, TicketSearchResult } from "@rundflug/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { type LoginAccount, loadLoginAccounts } from "../auth/api";
import type { OperationIdentity } from "../operations/operation-identity";
import { type TicketListTab, ticketMatchesListStatus } from "./CashierViewPresentation";
import { applyOperationBoardTicketStatuses } from "./cashier-ticket-status-sync";
import { useCashierTicketListData } from "./use-cashier-ticket-list-data";
import { useTemporaryRowHighlights } from "./use-temporary-row-highlights";

export function useCashierTicketList({
  board,
  clearReceipt,
  identity,
  serverConfirmed,
  sessionAccountId,
  setMessage,
}: {
  board: OperationBoard | null;
  clearReceipt: () => void;
  identity: OperationIdentity;
  serverConfirmed: boolean;
  sessionAccountId: string | undefined;
  setMessage: (message: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTabState] = useState<TicketListTab>("ACTIVE");
  const [accounts, setAccounts] = useState<LoginAccount[]>([]);
  const [accountFilter, setAccountFilter] = useState("");
  const [onlyOwnTickets, setOnlyOwnTickets] = useState(false);
  const [manualRefreshBusy, setManualRefreshBusy] = useState(false);
  const previousAccountFilterRef = useRef("");
  const effectiveAccountFilter = onlyOwnTickets ? (sessionAccountId ?? "") : accountFilter;
  const data = useCashierTicketListData({
    clearReceipt,
    currentAccountId: sessionAccountId,
    deviceId: identity.deviceId,
    deviceToken: identity.deviceToken,
    effectiveAccountFilter,
    eventId: identity.eventId,
    query,
    serverConfirmed,
    setMessage,
    status: tab,
  });
  const operationalGroups = useMemo(
    () => applyOperationBoardTicketStatuses(data.results, board?.rotations),
    [board?.rotations, data.results],
  );
  const visibleGroups = useMemo(
    () => operationalGroups.filter((entry) => ticketMatchesListStatus(entry, tab)),
    [operationalGroups, tab],
  );
  const selectedTicketGroup = operationalGroups.find(
    (entry) => entry.ticketGroupId === data.selectedTicketGroupId,
  );
  const selectedRotations =
    board?.rotations.filter((rotation) =>
      rotation.bookingGroups.some((group) => group.id === data.selectedTicketGroupId),
    ) ?? [];
  const { highlightedIds, queueHighlight } = useTemporaryRowHighlights(
    visibleGroups.map((entry) => entry.ticketGroupId),
  );

  useEffect(() => () => data.cancelStatusRefresh(), [data.cancelStatusRefresh]);
  useEffect(() => {
    void loadLoginAccounts()
      .then((availableAccounts) =>
        setAccounts(availableAccounts.filter((account) => account.role === "CASHIER")),
      )
      .catch(() => setAccounts([]));
  }, []);
  useEffect(() => {
    if (!serverConfirmed) return;
    void data.load();
  }, [data.load, serverConfirmed]);
  useEffect(() => {
    const boardVersion = board?.event.version ?? null;
    if (boardVersion === null) return;
    if (data.lastBoardVersionRef.current === null) {
      data.lastBoardVersionRef.current = boardVersion;
      return;
    }
    if (data.lastBoardVersionRef.current === boardVersion) return;
    data.lastBoardVersionRef.current = boardVersion;
    void data.revalidate();
  }, [board?.event.version, data.lastBoardVersionRef, data.revalidate]);
  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") {
        void data.load({ preserveLoaded: true }).then(data.revalidate);
      }
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [data.load, data.revalidate]);
  useEffect(() => {
    if (
      data.selectedTicketGroupId &&
      visibleGroups.some((group) => group.ticketGroupId === data.selectedTicketGroupId)
    ) {
      return;
    }
    const nextTicketGroupId = visibleGroups[0]?.ticketGroupId ?? null;
    if (nextTicketGroupId === data.selectedTicketGroupId) return;
    data.setSelectedTicketGroupId(nextTicketGroupId);
    clearReceipt();
  }, [clearReceipt, data.selectedTicketGroupId, data.setSelectedTicketGroupId, visibleGroups]);
  useEffect(() => {
    const sentinel = data.sentinelRef.current;
    if (!sentinel || !data.nextCursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !data.loading) {
          void data.load({ append: true });
        }
      },
      { root: sentinel.parentElement, rootMargin: "120px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [data.load, data.loading, data.nextCursor, data.sentinelRef]);

  function runSearch() {
    const requestedQuery = search.trim();
    if (requestedQuery.length === 1) {
      setMessage("Für die Suche mindestens zwei Zeichen eingeben.");
      return;
    }
    data.reset();
    if (requestedQuery === query) {
      void data.load({ query: requestedQuery });
      return;
    }
    setQuery(requestedQuery);
  }

  function changeAccountFilter(nextAccountId: string) {
    data.reset();
    if (nextAccountId === accountFilter) {
      void data.load(nextAccountId ? { soldByOperatorAccountId: nextAccountId } : {});
      return;
    }
    setAccountFilter(nextAccountId);
  }

  function changeOnlyOwnTickets(checked: boolean) {
    data.reset();
    if (checked) {
      previousAccountFilterRef.current = accountFilter;
      setOnlyOwnTickets(true);
      return;
    }
    setAccountFilter(previousAccountFilterRef.current);
    setOnlyOwnTickets(false);
  }

  function select(result: TicketSearchResult) {
    data.setSelectedTicketGroupId(result.ticketGroupId);
    clearReceipt();
  }

  async function refresh() {
    setManualRefreshBusy(true);
    try {
      await data.load({ preserveLoaded: true });
      await data.revalidate();
    } finally {
      setManualRefreshBusy(false);
    }
  }

  function setTab(nextTab: TicketListTab) {
    data.reset();
    setTabState(nextTab);
  }

  return {
    accountFilter,
    accounts,
    changeAccountFilter,
    changeOnlyOwnTickets,
    data,
    highlightedIds,
    manualRefreshBusy,
    onlyOwnTickets,
    query,
    queueHighlight,
    refresh,
    runSearch,
    search,
    select,
    selectedRotations,
    selectedTicketGroup,
    setSearch,
    setTab,
    tab,
    visibleGroups,
  };
}
