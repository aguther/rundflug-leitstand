import type {
  FidsBoardResponse,
  FidsBoardRow,
  FidsFilterOptions,
  FidsPreferences,
} from "@rundflug/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EditableFidsPreferences,
  FidsConnectionState,
  FidsDataSource,
} from "./fids-data-source";
import type { FidsLocationAdapter } from "./fids-location";

const DEFAULT_PREFERENCES: FidsPreferences = {
  visibleRows: 8,
  layout: "SINGLE",
  theme: "SYSTEM",
  viewMode: "FIXED_PAGE",
  priorityGroupCount: 3,
  rotationIntervalSeconds: 12,
  contentFilter: { productIds: [], gateIds: [] },
  version: 0,
};

const EMPTY_FILTER_OPTIONS: FidsFilterOptions = { gates: [], products: [] };
const HIGHLIGHT_DURATION_MS = 4_000;
const HIGHLIGHT_STATUSES = new Set(["PREPARE", "COME_TO_FLIGHT_LINE", "BOARDING"]);

function rowsById(board: FidsBoardResponse): Map<string, FidsBoardRow> {
  return new Map(
    [...(board.priority?.groups ?? []), ...board.page.groups].map((row) => [row.rowId, row]),
  );
}

export function useFidsExperience(input: {
  dataSource: FidsDataSource;
  locationAdapter: FidsLocationAdapter;
}) {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [filterOptions, setFilterOptions] = useState(EMPTY_FILTER_OPTIONS);
  const [filterOptionsLoaded, setFilterOptionsLoaded] = useState(false);
  const [board, setBoard] = useState<FidsBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<FidsConnectionState>(
    input.dataSource.initialConnection,
  );
  const [page, setPage] = useState(() => input.locationAdapter.getPage());
  const [setupMode, setSetupModeState] = useState(() => input.locationAdapter.isSetupMode());
  const [lowerPage, setLowerPage] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [highlightedRows, setHighlightedRows] = useState<ReadonlySet<string>>(new Set());
  const [linkCopied, setLinkCopied] = useState(false);
  const previousRows = useRef(new Map<string, FidsBoardRow>());
  const request = useRef<AbortController | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () =>
      input.locationAdapter.subscribe(() => {
        setPage(input.locationAdapter.getPage());
        setSetupModeState(input.locationAdapter.isSetupMode());
      }),
    [input.locationAdapter],
  );

  useEffect(() => {
    let active = true;
    void input.dataSource.loadPreferences().then(
      (nextPreferences) => {
        if (active) setPreferences(nextPreferences);
      },
      (cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "FIDS-Einstellungen nicht verfügbar.");
        }
      },
    );
    void input.dataSource.loadFilterOptions().then(
      (nextOptions) => {
        if (!active) return;
        setFilterOptions(nextOptions);
        setFilterOptionsLoaded(true);
      },
      (cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "FIDS-Filter nicht verfügbar.");
        }
      },
    );
    return () => {
      active = false;
    };
  }, [input.dataSource]);

  const refresh = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    void input.dataSource
      .loadBoard({ page, lowerPage, signal: controller.signal })
      .then((nextBoard) => {
        if (controller.signal.aborted) return;
        const previous = previousRows.current;
        const next = rowsById(nextBoard);
        const changed = new Set<string>();
        for (const [rowId, row] of next) {
          const prior = previous.get(rowId);
          if (
            prior &&
            ((prior.status !== row.status && HIGHLIGHT_STATUSES.has(row.status)) ||
              prior.gateId !== row.gateId)
          ) {
            changed.add(rowId);
          }
        }
        previousRows.current = next;
        if (changed.size > 0) {
          setHighlightedRows(changed);
          if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
          highlightTimer.current = window.setTimeout(() => {
            highlightTimer.current = null;
            setHighlightedRows(new Set());
          }, HIGHLIGHT_DURATION_MS);
        }
        setBoard(nextBoard);
        setError(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "FIDS-Anzeige nicht verfügbar.");
      });
  }, [input.dataSource, lowerPage, page]);
  refreshRef.current = refresh;

  useEffect(() => {
    refresh();
    return () => {
      request.current?.abort();
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    };
  }, [refresh]);

  useEffect(
    () => input.dataSource.subscribe(() => refreshRef.current(), setConnection),
    [input.dataSource],
  );

  useEffect(() => {
    if (!board || board.preferencesVersion === preferences.version) return;
    let active = true;
    void input.dataSource.loadPreferences().then((next) => {
      if (active) setPreferences(next);
    });
    return () => {
      active = false;
    };
  }, [board, input.dataSource, preferences.version]);

  const totalLowerPages = board?.viewMode === "SPLIT" ? board.page.totalPages : 0;
  useEffect(() => {
    if (board?.viewMode !== "SPLIT" || totalLowerPages <= 1) {
      setLowerPage(1);
      return;
    }
    setLowerPage((current) => (current > totalLowerPages ? 1 : current));
    const timer = window.setInterval(
      () => setLowerPage((current) => (current >= totalLowerPages ? 1 : current + 1)),
      preferences.rotationIntervalSeconds * 1_000,
    );
    return () => window.clearInterval(timer);
  }, [board?.viewMode, preferences.rotationIntervalSeconds, totalLowerPages]);

  const setSetupMode = useCallback(
    (active: boolean) => input.locationAdapter.setSetupMode(active),
    [input.locationAdapter],
  );

  const savePreferences = useCallback(
    async (draft: EditableFidsPreferences) => {
      if (!filterOptionsLoaded) {
        throw new Error("Filteroptionen sind noch nicht vollständig geladen.");
      }
      const knownProducts = new Set(filterOptions.products.map((option) => option.id));
      const knownGates = new Set(filterOptions.gates.map((option) => option.id));
      const normalized: EditableFidsPreferences = {
        ...draft,
        contentFilter: {
          productIds: draft.contentFilter.productIds.filter((id) => knownProducts.has(id)),
          gateIds: draft.contentFilter.gateIds.filter((id) => knownGates.has(id)),
        },
      };
      try {
        const saved = await input.dataSource.savePreferences(normalized, preferences.version);
        setPreferences(saved);
        setLowerPage(1);
        refreshRef.current();
      } catch (cause) {
        try {
          setPreferences(await input.dataSource.loadPreferences());
        } catch {
          // Keep the last confirmed version if the conflict refresh is also unavailable.
        }
        throw cause;
      }
    },
    [filterOptions, filterOptionsLoaded, input.dataSource, preferences.version],
  );

  const copyShareableUrl = useCallback(async () => {
    await navigator.clipboard.writeText(input.locationAdapter.getShareableUrl());
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 2_000);
  }, [input.locationAdapter]);

  return {
    board,
    clock,
    connection,
    copyShareableUrl,
    error,
    filterOptions,
    filterOptionsLoaded,
    highlightedRows,
    linkCopied,
    lowerPage,
    page,
    preferences,
    refresh,
    savePreferences,
    setPage: input.locationAdapter.setPage,
    setSettingsOpen,
    setSetupMode,
    settingsOpen,
    setupMode,
  };
}
