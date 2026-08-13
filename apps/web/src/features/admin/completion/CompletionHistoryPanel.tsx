import type {
  AuditHistory,
  ForecastHistory,
  OperationalHistory,
  OperationBoard,
} from "@rundflug/contracts";
import { Button } from "../../../design-system/components";
import { CompletionHistoryFilters } from "./CompletionHistoryFilters";
import { CompletionHistoryResults } from "./CompletionHistoryResults";

export type AdminHistoryView = "OPERATIONS" | "FORECASTS" | "AUDIT";

export interface AdminHistoryFilters {
  aggregateId: string;
  aggregateType: string;
  aircraftId: string;
  communicationNumber: string;
  eventType: string;
  pilotId: string;
  productId: string;
  resourceGroupId: string;
  rotationId: string;
  since: string;
  textSearch: string;
  ticketGroupId: string;
  ticketId: string;
  ticketStatus: string;
  until: string;
}

export type AdminHistoryFilterKey = keyof AdminHistoryFilters;

interface CompletionHistoryPanelProps {
  auditHistory: AuditHistory;
  board: OperationBoard;
  busyActionKey: string | null;
  filters: AdminHistoryFilters;
  forecastHistory: ForecastHistory;
  offset: number;
  onApplyFilters: () => void;
  onFilterChange: (key: AdminHistoryFilterKey, value: string, resetOffset?: boolean) => void;
  onNextPage: () => void | Promise<void>;
  onPreviousPage: () => void | Promise<void>;
  onResetFilters: () => void;
  operationalHistory: OperationalHistory;
  view: AdminHistoryView;
}

function HistoryPagination({
  busyActionKey,
  offset,
  onNextPage,
  onPreviousPage,
  total,
}: Readonly<
  Pick<
    CompletionHistoryPanelProps,
    "busyActionKey" | "offset" | "onNextPage" | "onPreviousPage"
  > & { total: number }
>) {
  return (
    <div className="history-pagination">
      <Button
        busy={busyActionKey === "history-previous"}
        disabled={offset === 0 || busyActionKey !== null}
        onClick={onPreviousPage}
        type="button"
      >
        Zurück
      </Button>
      <span>
        {offset + 1}–{Math.min(offset + 50, total)} von {total}
      </span>
      <Button
        busy={busyActionKey === "history-next"}
        disabled={busyActionKey !== null || offset + 50 >= total}
        onClick={onNextPage}
        type="button"
      >
        Weiter
      </Button>
    </div>
  );
}

function historyTotal(
  view: AdminHistoryView,
  operationalHistory: OperationalHistory,
  forecastHistory: ForecastHistory,
): number {
  if (view === "OPERATIONS") return operationalHistory.total;
  if (view === "FORECASTS") return forecastHistory.total;
  return 0;
}

export function CompletionHistoryPanel({
  auditHistory,
  board,
  busyActionKey,
  filters,
  forecastHistory,
  offset,
  onApplyFilters,
  onFilterChange,
  onNextPage,
  onPreviousPage,
  onResetFilters,
  operationalHistory,
  view,
}: Readonly<CompletionHistoryPanelProps>) {
  return (
    <section className="admin-section completion-history-panel">
      <CompletionHistoryFilters
        board={board}
        filters={filters}
        onApply={onApplyFilters}
        onChange={onFilterChange}
        onReset={onResetFilters}
        view={view}
      />
      <CompletionHistoryResults
        auditHistory={auditHistory}
        board={board}
        filters={filters}
        forecastHistory={forecastHistory}
        operationalHistory={operationalHistory}
        view={view}
      />
      {view !== "AUDIT" && (
        <HistoryPagination
          busyActionKey={busyActionKey}
          offset={offset}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
          total={historyTotal(view, operationalHistory, forecastHistory)}
        />
      )}
    </section>
  );
}
