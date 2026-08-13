import type { OperationBoard } from "@rundflug/contracts";
import { Button, Field } from "../../../design-system/components";
import { LocalizedDateTimeInput } from "../../../localized-date-input";
import { FieldGroupLabel, FieldLabel } from "../../../operation-workspace";
import type {
  AdminHistoryFilterKey,
  AdminHistoryFilters,
  AdminHistoryView,
} from "./CompletionHistoryPanel";

interface CompletionHistoryFiltersProps {
  board: OperationBoard;
  filters: AdminHistoryFilters;
  onApply: () => void;
  onChange: (key: AdminHistoryFilterKey, value: string, resetOffset?: boolean) => void;
  onReset: () => void;
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

const productCollator = new Intl.Collator("de-DE", { numeric: true, sensitivity: "base" });

function filterLegend(view: AdminHistoryView): string {
  const labels: Record<AdminHistoryView, string> = {
    OPERATIONS: "Betriebsdaten filtern",
    FORECASTS: "Prognosen filtern",
    AUDIT: "Audit-Ereignisse filtern",
  };
  return labels[view];
}

function VisibleHistoryFilters({
  board,
  filters,
  onChange,
  view,
}: Readonly<Pick<CompletionHistoryFiltersProps, "board" | "filters" | "onChange" | "view">>) {
  return (
    <div className="history-visible-filters">
      <LocalizedDateTimeInput
        label="Von"
        labelContent={
          <FieldGroupLabel label="Von" help="Optionaler Beginn des ausgewerteten Zeitraums." />
        }
        onChange={(value) => onChange("since", value)}
        value={filters.since}
      />
      <LocalizedDateTimeInput
        label="Bis"
        labelContent={
          <FieldGroupLabel label="Bis" help="Optionales Ende des ausgewerteten Zeitraums." />
        }
        onChange={(value) => onChange("until", value)}
        value={filters.until}
      />
      {view === "OPERATIONS" && (
        <div className="field-control">
          <FieldLabel
            htmlFor="history-communication-number"
            label="Fluggruppennummer"
            help="Stabile Kommunikationsnummer, keine garantierte Uhrzeit."
          />
          <input
            id="history-communication-number"
            min="1"
            onChange={(event) => onChange("communicationNumber", event.target.value)}
            type="number"
            value={filters.communicationNumber}
          />
        </div>
      )}
      {view === "FORECASTS" && (
        <div className="field-control">
          <FieldLabel
            htmlFor="history-aircraft"
            label="Flugzeug"
            help="Begrenzt Prognosen auf ein Flugzeug."
          />
          <select
            id="history-aircraft"
            onChange={(event) => onChange("aircraftId", event.target.value)}
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
      )}
      {view === "AUDIT" && (
        <div className="field-control history-readable-search">
          <FieldLabel
            htmlFor="history-readable-search"
            label="Ereignis oder Objekt suchen"
            help="Durchsucht lesbare Ereignis- und Objekttexte; unbekannte technische Typen bleiben auffindbar."
          />
          <input
            id="history-readable-search"
            onChange={(event) => onChange("textSearch", event.target.value)}
            placeholder="z. B. Fluggruppe aufgerufen"
            type="search"
            value={filters.textSearch}
          />
        </div>
      )}
    </div>
  );
}

function OperationalHistoryFilters({
  board,
  filters,
  onChange,
}: Readonly<Pick<CompletionHistoryFiltersProps, "board" | "filters" | "onChange">>) {
  const products = board.products.toSorted(
    (left, right) =>
      productCollator.compare(left.name, right.name) ||
      productCollator.compare(left.code, right.code),
  );
  return (
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
              onChange={(event) => onChange("aircraftId", event.target.value)}
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
              onChange={(event) => onChange("pilotId", event.target.value)}
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
              onChange={(event) => onChange("productId", event.target.value)}
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
              onChange={(event) => onChange("resourceGroupId", event.target.value)}
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
              onChange={(event) => onChange("ticketStatus", event.target.value)}
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
              onChange={(event) => onChange("rotationId", event.target.value)}
              value={filters.rotationId}
            />
          </Field>
          <Field label="Ticket-ID">
            <input
              onChange={(event) => onChange("ticketId", event.target.value)}
              value={filters.ticketId}
            />
          </Field>
          <Field label="Ticketgruppen-ID">
            <input
              onChange={(event) => onChange("ticketGroupId", event.target.value)}
              value={filters.ticketGroupId}
            />
          </Field>
        </div>
      </details>
    </>
  );
}

function ForecastHistoryFilters({
  board,
  filters,
  onChange,
}: Readonly<Pick<CompletionHistoryFiltersProps, "board" | "filters" | "onChange">>) {
  return (
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
              onChange={(event) => onChange("pilotId", event.target.value)}
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
              onChange={(event) => onChange("rotationId", event.target.value)}
              value={filters.rotationId}
            />
          </Field>
        </div>
      </details>
    </>
  );
}

function AuditHistoryFilters({
  filters,
  onChange,
}: Readonly<Pick<CompletionHistoryFiltersProps, "filters" | "onChange">>) {
  return (
    <details className="history-technical-filters">
      <summary>Technische Serverfilter</summary>
      <div>
        <Field label="Ereignistyp">
          <input
            onChange={(event) => onChange("eventType", event.target.value)}
            value={filters.eventType}
          />
        </Field>
        <Field label="Aggregate-Typ">
          <input
            onChange={(event) => onChange("aggregateType", event.target.value)}
            value={filters.aggregateType}
          />
        </Field>
        <Field label="Aggregate-ID">
          <input
            onChange={(event) => onChange("aggregateId", event.target.value)}
            value={filters.aggregateId}
          />
        </Field>
      </div>
    </details>
  );
}

const removableFilterLabels: Partial<Record<AdminHistoryFilterKey, string>> = {
  since: "Von entfernen",
  until: "Bis entfernen",
  communicationNumber: "Fluggruppe entfernen",
  aircraftId: "Flugzeug entfernen",
  pilotId: "Pilotencode entfernen",
  textSearch: "Suche entfernen",
};

function ActiveFilterChips({
  filters,
  onChange,
}: Readonly<Pick<CompletionHistoryFiltersProps, "filters" | "onChange">>) {
  return (
    <nav className="history-filter-chips" aria-label="Aktive Filter">
      {Object.entries(removableFilterLabels).map(([key, label]) => {
        const filterKey = key as AdminHistoryFilterKey;
        if (!filters[filterKey]) return null;
        return (
          <button key={filterKey} onClick={() => onChange(filterKey, "", true)} type="button">
            {label}
          </button>
        );
      })}
    </nav>
  );
}

export function CompletionHistoryFilters({
  board,
  filters,
  onApply,
  onChange,
  onReset,
  view,
}: Readonly<CompletionHistoryFiltersProps>) {
  return (
    <fieldset className="history-filters">
      <legend>{filterLegend(view)}</legend>
      <VisibleHistoryFilters board={board} filters={filters} onChange={onChange} view={view} />
      <div className="history-filter-disclosures">
        {view === "OPERATIONS" && (
          <OperationalHistoryFilters board={board} filters={filters} onChange={onChange} />
        )}
        {view === "FORECASTS" && (
          <ForecastHistoryFilters board={board} filters={filters} onChange={onChange} />
        )}
        {view === "AUDIT" && <AuditHistoryFilters filters={filters} onChange={onChange} />}
      </div>
      <ActiveFilterChips filters={filters} onChange={onChange} />
      <div className="history-filter-actions">
        <Button onClick={onApply} type="button" variant="primary">
          Anwenden
        </Button>
        <Button onClick={onReset} type="button">
          Zurücksetzen
        </Button>
      </div>
    </fieldset>
  );
}
