import type { OperationBoard } from "@rundflug/contracts";
import { Button } from "../../../design-system/components";
import { formatEventLocalDateTime } from "../../../event-time";

interface CompletionSummaryPanelProps {
  board: OperationBoard;
  busyActionKey: string | null;
  onExportDailyCsv: () => void;
  onExportDailyPdf: () => void;
  onExportPerformance: () => void;
  onExportRawData: () => void;
}

export function CompletionSummaryPanel({
  board,
  busyActionKey,
  onExportDailyCsv,
  onExportDailyPdf,
  onExportPerformance,
  onExportRawData,
}: CompletionSummaryPanelProps) {
  return (
    <section className="admin-section completion-day-summary">
      <div className="section-heading">
        <div>
          <h2>Tagesübersicht</h2>
          <p>Veranstaltungs-, Zeitraum- und Board-Kennzahlen des bestätigten Stands.</p>
        </div>
      </div>
      <dl className="completion-summary-grid">
        <div>
          <dt>Betriebsbeginn</dt>
          <dd>
            {formatEventLocalDateTime(board.event.operationsStartAt, board.event.timeZone) ||
              "Nicht gestartet"}
          </dd>
        </div>
        <div>
          <dt>Betriebsende</dt>
          <dd>
            {formatEventLocalDateTime(board.event.operationsEndAt, board.event.timeZone) ||
              "Nicht gesetzt"}
          </dd>
        </div>
        <div>
          <dt>Abgeschlossene Umläufe</dt>
          <dd>{board.metrics.completedRotations}</dd>
        </div>
        <div>
          <dt>Offene Tickets</dt>
          <dd>{board.metrics.openTickets}</dd>
        </div>
        <div>
          <dt>Ø Umlaufzeit</dt>
          <dd>{board.metrics.averageRotationMinutes ?? "–"} Min.</dd>
        </div>
        <div>
          <dt>Informatorischer Umsatz</dt>
          <dd>
            {(board.metrics.informationalRevenueCents / 100).toLocaleString("de-DE", {
              style: "currency",
              currency: "EUR",
            })}
          </dd>
        </div>
      </dl>
      <div className="completion-primary-exports">
        <Button
          busy={busyActionKey === "export-daily-pdf"}
          onClick={onExportDailyPdf}
          type="button"
          variant="primary"
        >
          PDF-Tagesbericht
        </Button>
        <Button
          busy={busyActionKey === "export-daily-csv"}
          onClick={onExportDailyCsv}
          type="button"
        >
          CSV-Tagesbericht
        </Button>
      </div>
      <details className="completion-secondary-exports">
        <summary>Weitere Datenexporte</summary>
        <div>
          <Button
            busy={busyActionKey === "export-raw-data"}
            onClick={onExportRawData}
            type="button"
          >
            Ticket-Rohdaten CSV
          </Button>
          <Button
            busy={busyActionKey === "export-performance"}
            onClick={onExportPerformance}
            type="button"
          >
            Leistungsprofil JSON
          </Button>
        </div>
      </details>
    </section>
  );
}
