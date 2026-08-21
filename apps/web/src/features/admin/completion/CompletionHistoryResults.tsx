import type {
  AuditHistory,
  ForecastHistory,
  OperationalHistory,
  OperationBoard,
} from "@rundflug/contracts";
import type { AdminHistoryFilters, AdminHistoryView } from "./CompletionHistoryPanel";

interface CompletionHistoryResultsProps {
  auditHistory: AuditHistory;
  board: OperationBoard;
  filters: AdminHistoryFilters;
  forecastHistory: ForecastHistory;
  operationalHistory: OperationalHistory;
  view: AdminHistoryView;
}

const ticketStatusLabels: Record<string, string> = {
  QUEUED: "In Warteschlange",
  CHECKED_IN: "Eingecheckt",
  CALLED: "Aufgerufen",
  BOARDING: "Boarding",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
  NO_SHOW: "Nicht erschienen",
  CANCELED: "Storniert",
  CLARIFICATION: "Klärung erforderlich",
};

const eventLabels: Record<string, string> = {
  TICKET_NO_SHOW: "Ticket als nicht erschienen markiert",
  ROTATION_CALLED: "Fluggruppe aufgerufen",
  ROTATION_DEPARTED: "Umlauf gestartet",
  ROTATION_LANDED: "Umlauf gelandet",
  ROTATION_COMPLETED: "Umlauf abgeschlossen",
  AIRCRAFT_RESOURCE_GROUP_ASSIGNED: "Flugzeug einer Ressourcengruppe zugeordnet",
  PRODUCT_SALES_CONFIGURED: "Verkaufssteuerung geändert",
  EMERGENCY_TRIGGERED: "Notfallmodus aktiviert",
  EMERGENCY_CLEARED: "Notfallmodus aufgehoben",
};

function OperationalHistoryTable({
  board,
  history,
}: Readonly<{ board: OperationBoard; history: OperationalHistory }>) {
  return (
    <div className="history-table-wrap">
      <table className="history-table">
        <thead>
          <tr>
            <th>Zeitpunkt</th>
            <th>Fluggruppe</th>
            <th>Ticket / Gruppe</th>
            <th>Status</th>
            <th>Flugzeug</th>
            <th>Pilot</th>
          </tr>
        </thead>
        <tbody>
          {history.entries.map((entry) => (
            <tr key={`${entry.ticketId}-${entry.rotationId ?? "open"}`}>
              <td>
                {new Date(entry.latestAt).toLocaleString("de-DE", {
                  timeZone: board.event.timeZone,
                })}
              </td>
              <td>{entry.communicationLabel ?? "Noch offen"}</td>
              <td>
                Anonymes Ticket
                <details className="history-row-details">
                  <summary>Technische Details</summary>
                  <code className="ui-select-all">{entry.ticketId}</code>
                  <code className="ui-select-all">{entry.ticketGroupId}</code>
                  {entry.rotationId && <code className="ui-select-all">{entry.rotationId}</code>}
                </details>
              </td>
              <td>{ticketStatusLabels[entry.ticketStatus] ?? entry.ticketStatus}</td>
              <td>{entry.aircraftRegistration ?? "–"}</td>
              <td>{entry.pilotOperationalCode ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {history.entries.length === 0 && <p>Keine passenden Betriebsdaten.</p>}
    </div>
  );
}

function ForecastHistoryTable({
  board,
  history,
}: Readonly<{ board: OperationBoard; history: ForecastHistory }>) {
  return (
    <div className="history-table-wrap">
      <table className="history-table forecast-history-table">
        <thead>
          <tr>
            <th>Snapshot</th>
            <th>Fluggruppe</th>
            <th>Auslöser</th>
            <th>Qualität / Grundlage</th>
            <th>Abweichungen in Minuten</th>
          </tr>
        </thead>
        <tbody>
          {history.entries.map((entry) => (
            <tr key={entry.snapshotId}>
              <td>
                {new Date(entry.capturedAt).toLocaleString("de-DE", {
                  timeZone: board.event.timeZone,
                })}
              </td>
              <td>
                {entry.communicationLabel}
                <details className="history-row-details">
                  <summary>Technische Details</summary>
                  <code className="ui-select-all">{entry.rotationId}</code>
                  <code className="ui-select-all">{entry.snapshotId}</code>
                </details>
              </td>
              <td>{eventLabels[entry.triggerEventType] ?? entry.triggerEventType}</td>
              <td>
                {entry.quality}
                <small>
                  {entry.dataBasisScope} · n={entry.sampleSize} · Alter{" "}
                  {Math.round(entry.dataAgeMinutes)} Min.
                </small>
              </td>
              <td>
                <span>Boarding {entry.deviationMinutes.boarding ?? "–"}</span>
                <span>Start {entry.deviationMinutes.departure ?? "–"}</span>
                <span>Landung {entry.deviationMinutes.landing ?? "–"}</span>
                <span>Abschluss {entry.deviationMinutes.completion ?? "–"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {history.entries.length === 0 && <p>Keine passenden Prognosesnapshots.</p>}
    </div>
  );
}

function AuditHistoryList({
  board,
  filters,
  history,
}: Readonly<{
  board: OperationBoard;
  filters: AdminHistoryFilters;
  history: AuditHistory;
}>) {
  const search = filters.textSearch.trim().toLocaleLowerCase("de-DE");
  const visibleEntries = history.entries
    .filter((entry) =>
      `${eventLabels[entry.eventType] ?? entry.eventType} ${entry.eventType} ${entry.aggregateType}`
        .toLocaleLowerCase("de-DE")
        .includes(search),
    )
    .slice(0, 50);
  return (
    <div className="audit-list">
      {visibleEntries.map((entry) => (
        <div key={entry.sequence}>
          <time dateTime={entry.occurredAt}>
            {new Date(entry.occurredAt).toLocaleString("de-DE", {
              timeZone: board.event.timeZone,
            })}
          </time>
          <strong>{eventLabels[entry.eventType] ?? entry.eventType}</strong>
          {eventLabels[entry.eventType] && <small>{entry.eventType}</small>}
          <details className="history-row-details">
            <summary>Technische Details</summary>
            <span>
              {entry.aggregateType} · Version {entry.aggregateVersion}
            </span>
            <code className="ui-select-all">{entry.aggregateId}</code>
          </details>
        </div>
      ))}
      {history.entries.length === 0 && <p>Keine passenden Ereignisse.</p>}
    </div>
  );
}

export function CompletionHistoryResults({
  auditHistory,
  board,
  filters,
  forecastHistory,
  operationalHistory,
  view,
}: Readonly<CompletionHistoryResultsProps>) {
  if (view === "OPERATIONS") {
    return <OperationalHistoryTable board={board} history={operationalHistory} />;
  }
  if (view === "FORECASTS") {
    return <ForecastHistoryTable board={board} history={forecastHistory} />;
  }
  return <AuditHistoryList board={board} filters={filters} history={auditHistory} />;
}
