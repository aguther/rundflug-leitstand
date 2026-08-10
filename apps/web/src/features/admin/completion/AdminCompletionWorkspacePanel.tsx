import type { OperationBoard } from "@rundflug/contracts";
import type { useAdminMasterDataActions } from "../master-data/useAdminMasterDataActions";
import { AdminCompletionSummaryPanel } from "./AdminCompletionSummaryPanel";
import { CompletionHistoryPanel } from "./CompletionHistoryPanel";
import { CompletionWorkspace } from "./CompletionWorkspace";
import { ManifestCorrectionPanel } from "./ManifestCorrectionPanel";
import type { useAdminHistory } from "./useAdminHistory";

interface AdminCompletionWorkspacePanelProps {
  administrator: boolean;
  board: OperationBoard;
  busyActionKey: string | null;
  history: ReturnType<typeof useAdminHistory>;
  manifestCorrectionResetKey: number;
  onMessage: (message: string) => void;
  onRequestManifestCorrection: ReturnType<
    typeof useAdminMasterDataActions
  >["requestManifestCorrection"];
  onRunBusyAction: (key: string, action: () => Promise<void>) => Promise<void>;
}

export function AdminCompletionWorkspacePanel({
  administrator,
  board,
  busyActionKey,
  history,
  manifestCorrectionResetKey,
  onMessage,
  onRequestManifestCorrection,
  onRunBusyAction,
}: AdminCompletionWorkspacePanelProps) {
  return (
    <section
      aria-labelledby="admin-event-step-completion-tab"
      id="admin-event-step-completion-panel"
      role="tabpanel"
    >
      <CompletionWorkspace
        board={board}
        onHistoryTabChange={history.changeView}
        summary={
          <AdminCompletionSummaryPanel
            board={board}
            busyActionKey={busyActionKey}
            onMessage={onMessage}
            onRunBusyAction={onRunBusyAction}
          />
        }
        history={
          <CompletionHistoryPanel
            auditHistory={history.auditHistory}
            board={board}
            busyActionKey={busyActionKey}
            filters={history.filters}
            forecastHistory={history.forecastHistory}
            offset={history.offset}
            onApplyFilters={history.applyFilters}
            onFilterChange={history.changeFilter}
            onNextPage={() =>
              onRunBusyAction("history-next", () =>
                history.refreshDetailedHistory(history.offset + 50),
              )
            }
            onPreviousPage={() =>
              onRunBusyAction("history-previous", () =>
                history.refreshDetailedHistory(Math.max(0, history.offset - 50)),
              )
            }
            onResetFilters={history.resetFilters}
            operationalHistory={history.operationalHistory}
            view={history.view}
          />
        }
        corrections={
          <ManifestCorrectionPanel
            administrator={administrator}
            board={board}
            busy={busyActionKey === "manifest-correction"}
            key={manifestCorrectionResetKey}
            onCorrect={onRequestManifestCorrection}
          />
        }
      />
    </section>
  );
}
