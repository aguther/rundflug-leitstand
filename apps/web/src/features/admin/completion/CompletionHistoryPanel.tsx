import type {
  AuditHistory,
  ForecastHistory,
  OperationalHistory,
  OperationBoard,
} from "@rundflug/contracts";
import { Button, Field } from "../../../design-system/components";
import { LocalizedDateTimeInput } from "../../../localized-date-input";
import { FieldGroupLabel, FieldLabel } from "../../../operation-workspace";

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

const productCollator = new Intl.Collator("de-DE", { numeric: true, sensitivity: "base" });

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
}: CompletionHistoryPanelProps) {
  const products = board.products.toSorted(
    (left, right) =>
      productCollator.compare(left.name, right.name) ||
      productCollator.compare(left.code, right.code),
  );
  const total = view === "OPERATIONS" ? operationalHistory.total : forecastHistory.total;

  return (
    <section className="admin-section completion-history-panel">
      <fieldset className="history-filters">
        <legend>
          {view === "OPERATIONS"
            ? "Betriebsdaten filtern"
            : view === "FORECASTS"
              ? "Prognosen filtern"
              : "Audit-Ereignisse filtern"}
        </legend>
        <div className="history-visible-filters">
          <LocalizedDateTimeInput
            label="Von"
            labelContent={
              <FieldGroupLabel label="Von" help="Optionaler Beginn des ausgewerteten Zeitraums." />
            }
            onChange={(value) => onFilterChange("since", value)}
            value={filters.since}
          />
          <LocalizedDateTimeInput
            label="Bis"
            labelContent={
              <FieldGroupLabel label="Bis" help="Optionales Ende des ausgewerteten Zeitraums." />
            }
            onChange={(value) => onFilterChange("until", value)}
            value={filters.until}
          />
          {view === "OPERATIONS" ? (
            <div className="field-control">
              <FieldLabel
                htmlFor="history-communication-number"
                label="Fluggruppennummer"
                help="Stabile Kommunikationsnummer, keine garantierte Uhrzeit."
              />
              <input
                id="history-communication-number"
                min="1"
                onChange={(event) => onFilterChange("communicationNumber", event.target.value)}
                type="number"
                value={filters.communicationNumber}
              />
            </div>
          ) : null}
          {view === "FORECASTS" ? (
            <div className="field-control">
              <FieldLabel
                htmlFor="history-aircraft"
                label="Flugzeug"
                help="Begrenzt Prognosen auf ein Flugzeug."
              />
              <select
                id="history-aircraft"
                onChange={(event) => onFilterChange("aircraftId", event.target.value)}
                value={filters.aircraftId}
              >
                <option value="">Alle</option>
                {board.aircraft.map((aircraft) => (
                  <option key={aircraft.id} value={aircraft.id}>
                    {aircraft.registration}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {view === "AUDIT" ? (
            <div className="field-control history-readable-search">
              <FieldLabel
                htmlFor="history-readable-search"
                label="Ereignis oder Objekt suchen"
                help="Durchsucht lesbare Ereignis- und Objekttexte; unbekannte technische Typen bleiben auffindbar."
              />
              <input
                id="history-readable-search"
                onChange={(event) => onFilterChange("textSearch", event.target.value)}
                placeholder="z. B. Fluggruppe aufgerufen"
                type="search"
                value={filters.textSearch}
              />
            </div>
          ) : null}
        </div>
        {view === "OPERATIONS" ? (
          <>
            <details className="history-advanced-filters">
              <summary>Fachliche Filter</summary>
              <div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="history-aircraft"
                    label="Flugzeug"
                    help="Begrenzt die Betriebshistorie auf ein Flugzeug."
                  />
                  <select
                    id="history-aircraft"
                    onChange={(event) => onFilterChange("aircraftId", event.target.value)}
                    value={filters.aircraftId}
                  >
                    <option value="">Alle</option>
                    {board.aircraft.map((aircraft) => (
                      <option key={aircraft.id} value={aircraft.id}>
                        {aircraft.registration}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="history-pilot"
                    label="Pilotencode"
                    help="Anonymer operativer Pilotencode."
                  />
                  <select
                    id="history-pilot"
                    onChange={(event) => onFilterChange("pilotId", event.target.value)}
                    value={filters.pilotId}
                  >
                    <option value="">Alle</option>
                    {board.pilots.map((pilot) => (
                      <option key={pilot.id} value={pilot.id}>
                        {pilot.operationalCode}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="history-product"
                    label="Produkt"
                    help="Begrenzt die Betriebshistorie auf ein Produkt."
                  />
                  <select
                    id="history-product"
                    onChange={(event) => onFilterChange("productId", event.target.value)}
                    value={filters.productId}
                  >
                    <option value="">Alle</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="history-resource-group"
                    label="Ressourcengruppe"
                    help="Begrenzt die Historie auf eine operative Queue."
                  />
                  <select
                    id="history-resource-group"
                    onChange={(event) => onFilterChange("resourceGroupId", event.target.value)}
                    value={filters.resourceGroupId}
                  >
                    <option value="">Alle</option>
                    {board.resourceGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="history-ticket-status"
                    label="Ticketstatus"
                    help="Lesbarer Status des anonymen Tickets."
                  />
                  <select
                    id="history-ticket-status"
                    onChange={(event) => onFilterChange("ticketStatus", event.target.value)}
                    value={filters.ticketStatus}
                  >
                    <option value="">Alle</option>
                    {Object.entries(ticketStatusLabels).map(([status, label]) => (
                      <option key={status} value={status}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </details>
            <details className="history-technical-filters">
              <summary>Technische Filter</summary>
              <div>
                <Field label="Umlauf-ID">
                  <input
                    onChange={(event) => onFilterChange("rotationId", event.target.value)}
                    value={filters.rotationId}
                  />
                </Field>
                <Field label="Ticket-ID">
                  <input
                    onChange={(event) => onFilterChange("ticketId", event.target.value)}
                    value={filters.ticketId}
                  />
                </Field>
                <Field label="Ticketgruppen-ID">
                  <input
                    onChange={(event) => onFilterChange("ticketGroupId", event.target.value)}
                    value={filters.ticketGroupId}
                  />
                </Field>
              </div>
            </details>
          </>
        ) : null}
        {view === "FORECASTS" ? (
          <>
            <details className="history-advanced-filters">
              <summary>Weitere fachliche Filter</summary>
              <div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="history-pilot"
                    label="Pilotencode"
                    help="Anonymer operativer Pilotencode."
                  />
                  <select
                    id="history-pilot"
                    onChange={(event) => onFilterChange("pilotId", event.target.value)}
                    value={filters.pilotId}
                  >
                    <option value="">Alle</option>
                    {board.pilots.map((pilot) => (
                      <option key={pilot.id} value={pilot.id}>
                        {pilot.operationalCode}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </details>
            <details className="history-technical-filters">
              <summary>Technische Filter</summary>
              <div>
                <Field label="Umlauf-ID">
                  <input
                    onChange={(event) => onFilterChange("rotationId", event.target.value)}
                    value={filters.rotationId}
                  />
                </Field>
              </div>
            </details>
          </>
        ) : null}
        {view === "AUDIT" ? (
          <details className="history-technical-filters">
            <summary>Technische Serverfilter</summary>
            <div>
              <Field label="Ereignistyp">
                <input
                  onChange={(event) => onFilterChange("eventType", event.target.value)}
                  value={filters.eventType}
                />
              </Field>
              <Field label="Aggregate-Typ">
                <input
                  onChange={(event) => onFilterChange("aggregateType", event.target.value)}
                  value={filters.aggregateType}
                />
              </Field>
              <Field label="Aggregate-ID">
                <input
                  onChange={(event) => onFilterChange("aggregateId", event.target.value)}
                  value={filters.aggregateId}
                />
              </Field>
            </div>
          </details>
        ) : null}
        <nav className="history-filter-chips" aria-label="Aktive Filter">
          {filters.since ? (
            <button onClick={() => onFilterChange("since", "", true)} type="button">
              Von entfernen
            </button>
          ) : null}
          {filters.until ? (
            <button onClick={() => onFilterChange("until", "", true)} type="button">
              Bis entfernen
            </button>
          ) : null}
          {filters.communicationNumber ? (
            <button onClick={() => onFilterChange("communicationNumber", "", true)} type="button">
              Fluggruppe entfernen
            </button>
          ) : null}
          {filters.aircraftId ? (
            <button onClick={() => onFilterChange("aircraftId", "", true)} type="button">
              Flugzeug entfernen
            </button>
          ) : null}
          {filters.pilotId ? (
            <button onClick={() => onFilterChange("pilotId", "", true)} type="button">
              Pilotencode entfernen
            </button>
          ) : null}
          {filters.textSearch ? (
            <button onClick={() => onFilterChange("textSearch", "", true)} type="button">
              Suche entfernen
            </button>
          ) : null}
        </nav>
        <div className="history-filter-actions">
          <Button onClick={onApplyFilters} type="button" variant="primary">
            Anwenden
          </Button>
          <Button onClick={onResetFilters} type="button">
            Zurücksetzen
          </Button>
        </div>
      </fieldset>
      {view === "OPERATIONS" ? (
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
              {operationalHistory.entries.map((entry) => (
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
                      <code>{entry.ticketId}</code>
                      <code>{entry.ticketGroupId}</code>
                      {entry.rotationId ? <code>{entry.rotationId}</code> : null}
                    </details>
                  </td>
                  <td>{ticketStatusLabels[entry.ticketStatus] ?? entry.ticketStatus}</td>
                  <td>{entry.aircraftRegistration ?? "–"}</td>
                  <td>{entry.pilotOperationalCode ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {operationalHistory.entries.length === 0 ? <p>Keine passenden Betriebsdaten.</p> : null}
        </div>
      ) : view === "FORECASTS" ? (
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
              {forecastHistory.entries.map((entry) => (
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
                      <code>{entry.rotationId}</code>
                      <code>{entry.snapshotId}</code>
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
          {forecastHistory.entries.length === 0 ? <p>Keine passenden Prognosesnapshots.</p> : null}
        </div>
      ) : (
        <div className="audit-list">
          {auditHistory.entries
            .filter((entry) =>
              `${eventLabels[entry.eventType] ?? entry.eventType} ${entry.eventType} ${entry.aggregateType}`
                .toLocaleLowerCase("de-DE")
                .includes(filters.textSearch.trim().toLocaleLowerCase("de-DE")),
            )
            .slice(0, 50)
            .map((entry) => (
              <div key={entry.sequence}>
                <time dateTime={entry.occurredAt}>
                  {new Date(entry.occurredAt).toLocaleString("de-DE", {
                    timeZone: board.event.timeZone,
                  })}
                </time>
                <strong>{eventLabels[entry.eventType] ?? entry.eventType}</strong>
                {eventLabels[entry.eventType] ? <small>{entry.eventType}</small> : null}
                <details className="history-row-details">
                  <summary>Technische Details</summary>
                  <span>
                    {entry.aggregateType} · Version {entry.aggregateVersion}
                  </span>
                  <code>{entry.aggregateId}</code>
                </details>
              </div>
            ))}
          {auditHistory.entries.length === 0 ? <p>Keine passenden Ereignisse.</p> : null}
        </div>
      )}
      {view !== "AUDIT" ? (
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
      ) : null}
    </section>
  );
}
