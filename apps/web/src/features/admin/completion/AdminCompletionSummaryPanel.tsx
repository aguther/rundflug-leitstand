import type { OperationBoard } from "@rundflug/contracts";
import {
  downloadDailyPdf,
  downloadDailyReport,
  downloadPerformanceProfile,
  downloadTicketRawData,
} from "../../../api";
import { useAdminOperationIdentity } from "../../operations/operation-identity";
import { CompletionSummaryPanel } from "./CompletionSummaryPanel";

interface AdminCompletionSummaryPanelProps {
  board: OperationBoard;
  busyActionKey: string | null;
  onMessage: (message: string) => void;
  onRunBusyAction: (key: string, action: () => Promise<void>) => Promise<void>;
}

export function AdminCompletionSummaryPanel({
  board,
  busyActionKey,
  onMessage,
  onRunBusyAction,
}: Readonly<AdminCompletionSummaryPanelProps>) {
  const {
    eventId: EVENT_ID,
    deviceId: ADMIN_DEVICE_ID,
    deviceToken: ADMIN_DEVICE_TOKEN,
  } = useAdminOperationIdentity();
  async function exportFile(
    download: (eventId: string, deviceId: string, deviceToken: string) => Promise<void>,
    successMessage: string,
    fallbackError: string,
  ) {
    try {
      await download(EVENT_ID, ADMIN_DEVICE_ID, ADMIN_DEVICE_TOKEN);
      onMessage(successMessage);
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : fallbackError);
    }
  }

  return (
    <CompletionSummaryPanel
      board={board}
      busyActionKey={busyActionKey}
      onExportDailyCsv={() =>
        void onRunBusyAction("export-daily-csv", () =>
          exportFile(
            downloadDailyReport,
            "Tagesbericht wurde erzeugt.",
            "Tagesbericht fehlgeschlagen.",
          ),
        )
      }
      onExportDailyPdf={() =>
        void onRunBusyAction("export-daily-pdf", () =>
          exportFile(
            downloadDailyPdf,
            "PDF-Tagesbericht wurde erzeugt.",
            "PDF-Tagesbericht fehlgeschlagen.",
          ),
        )
      }
      onExportPerformance={() =>
        void onRunBusyAction("export-performance", () =>
          exportFile(
            downloadPerformanceProfile,
            "Kontextbezogenes Leistungsprofil wurde exportiert.",
            "Leistungsprofil konnte nicht exportiert werden.",
          ),
        )
      }
      onExportRawData={() =>
        void onRunBusyAction("export-raw-data", () =>
          exportFile(
            downloadTicketRawData,
            "Ticket-Rohdaten wurden exportiert.",
            "Rohdatenexport fehlgeschlagen.",
          ),
        )
      }
    />
  );
}
