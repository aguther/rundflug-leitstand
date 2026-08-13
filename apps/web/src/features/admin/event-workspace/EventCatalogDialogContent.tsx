import type { EventCatalogEntry } from "@rundflug/contracts";
import { Plus, Trash2 } from "lucide-react";
import { ValidationHint } from "../../../admin-ux";
import { Button, PageHeader, Panel, SearchField } from "../../../design-system/components";
import { formatGermanDate, LocalizedDateInput } from "../../../localized-date-input";
import { FieldGroupLabel, FieldLabel } from "../../../operation-workspace";
import type {
  EventCatalogDialogProps,
  EventCreationDraft,
  EventSortKey,
  EventSortState,
} from "./EventCatalogDialog";

const EVENT_SORT_COLUMNS = [
  ["name", "Veranstaltungsname"],
  ["eventDate", "Datum"],
  ["status", "Phase"],
  ["aerodrome", "Flugplatz"],
] as const;

type EventCatalogViewProps = Pick<
  EventCatalogDialogProps,
  | "busyActionKey"
  | "canExport"
  | "canManage"
  | "currentEventId"
  | "currentStep"
  | "events"
  | "onDelete"
  | "onExport"
  | "onImport"
  | "onOpenCreate"
  | "onSearchChange"
  | "onSort"
  | "search"
  | "sort"
>;

type EventCreationFormProps = Pick<
  EventCatalogDialogProps,
  | "creation"
  | "currentEventId"
  | "currentEventName"
  | "onCreateSubmit"
  | "onSetCreationAerodrome"
  | "onSetCreationConfirmation"
  | "onSetCreationDate"
  | "onSetCreationId"
  | "onSetCreationName"
  | "onSetRestartMode"
>;

interface EventCreationFooterProps {
  busyActionKey: string | null;
  creation: EventCreationDraft;
  onShowCatalog: () => void;
}

function ariaSort(sort: EventSortState, key: EventSortKey) {
  if (sort.key !== key || !sort.direction) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

function sortIndicator(sort: EventSortState, key: EventSortKey) {
  if (sort.key !== key || !sort.direction) return "↕";
  return sort.direction === "asc" ? "↑" : "↓";
}

function eventStatusLabel(status: EventCatalogEntry["status"]) {
  switch (status) {
    case "PREPARATION":
      return "Vorbereitung";
    case "ACTIVE":
      return "Aktiv";
    case "CLOSED":
      return "Geschlossen";
    default:
      return "Archiviert";
  }
}

function restartModeHelp(restartMode: EventCreationDraft["restartMode"]) {
  if (restartMode === "KEEP_MASTER_DATA") {
    return "Übernommen werden Parameter, Gates, Ressourcengruppen, Produkte, Flugzeugzuordnungen und Piloten-IDs. Verkäufe bleiben zunächst gesperrt.";
  }
  return "Nur Veranstaltungsdaten, Grundeinstellungen und das erste Administrationskonto werden angelegt. Alle Stammdaten beginnen leer.";
}

function EventCatalogView({
  busyActionKey,
  canExport,
  canManage,
  currentEventId,
  currentStep,
  events,
  onDelete,
  onExport,
  onImport,
  onOpenCreate,
  onSearchChange,
  onSort,
  search,
  sort,
}: Readonly<EventCatalogViewProps>) {
  return (
    <Panel className="event-catalog-v15 event-catalog-primary" padding="none">
      <PageHeader
        actions={
          <div className="event-catalog-actions">
            <SearchField
              label="Veranstaltungen durchsuchen"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Veranstaltungen suchen …"
              value={search}
            />
            <Button
              busy={busyActionKey === "export-master-data-template"}
              disabled={!canExport || busyActionKey !== null}
              onClick={onExport}
              size="compact"
            >
              Stammdaten exportieren
            </Button>
            <Button disabled={!canExport || !canManage} onClick={onImport} size="compact">
              Stammdaten importieren
            </Button>
            <Button disabled={!canManage} onClick={onOpenCreate} size="compact" variant="primary">
              <Plus aria-hidden="true" /> Neue Veranstaltung
            </Button>
          </div>
        }
        level={2}
        title="Veranstaltungen"
      />
      <div className="event-catalog-table-wrap">
        <table className="event-catalog-table">
          <thead>
            <tr>
              {EVENT_SORT_COLUMNS.map(([key, label]) => (
                <th aria-sort={ariaSort(sort, key)} key={key}>
                  <button className="admin-sort-button" onClick={() => onSort(key)} type="button">
                    {label}
                    <span aria-hidden="true">{sortIndicator(sort, key)}</span>
                  </button>
                </th>
              ))}
              <th>Zeitzone</th>
              <th>
                <span className="visually-hidden">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((entry) => (
              <tr
                aria-selected={entry.eventId === currentEventId}
                className={entry.eventId === currentEventId ? "is-current" : ""}
                key={entry.eventId}
              >
                <td>
                  <div className="event-catalog-name">
                    <a
                      href={`/admin?event=${encodeURIComponent(entry.eventId)}&area=events&step=${currentStep}`}
                    >
                      {entry.name}
                    </a>
                    <span className="event-catalog-entry-id">
                      Technische ID: <code>{entry.eventId}</code>
                    </span>
                  </div>
                </td>
                <td>{formatGermanDate(entry.eventDate)}</td>
                <td>{eventStatusLabel(entry.status)}</td>
                <td>{entry.aerodrome || "–"}</td>
                <td>{entry.timeZone}</td>
                <td>
                  <Button
                    aria-label={`${entry.name} löschen`}
                    busy={busyActionKey === `delete-event-${entry.eventId}`}
                    onClick={() => onDelete(entry)}
                    size="compact"
                    variant="danger"
                  >
                    <Trash2 aria-hidden="true" /> Löschen
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 ? (
          <p className="event-catalog-empty">Keine passende Veranstaltung gefunden.</p>
        ) : null}
      </div>
    </Panel>
  );
}

function EventCreationForm({
  creation,
  currentEventId,
  currentEventName,
  onCreateSubmit,
  onSetCreationAerodrome,
  onSetCreationConfirmation,
  onSetCreationDate,
  onSetCreationId,
  onSetCreationName,
  onSetRestartMode,
}: Readonly<EventCreationFormProps>) {
  return (
    <form
      className="event-create-dialog-form"
      id="event-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!creation.disabled) onCreateSubmit();
      }}
    >
      <div className="event-create-source">
        <div>
          <span>Ausgangsveranstaltung</span>
          <strong>{currentEventName}</strong>
        </div>
        <code>{currentEventId}</code>
      </div>

      <section className="event-create-section">
        <div className="event-create-section-heading">
          <h3>Veranstaltungsdaten</h3>
          <p>Die technische ID ist die eindeutige, URL-taugliche Kennung.</p>
        </div>
        <div className="event-create-form-grid">
          <div className="field-control">
            <FieldLabel
              htmlFor="new-event-id"
              label="Technische ID"
              help="3–64 Kleinbuchstaben, Ziffern oder Bindestriche; zum Beispiel rundflug-2027."
            />
            <input
              autoCapitalize="none"
              id="new-event-id"
              maxLength={64}
              onChange={(event) => onSetCreationId(event.target.value.toLowerCase())}
              pattern="[a-z0-9-]{3,64}"
              placeholder="rundflug-2027"
              required
              spellCheck={false}
              value={creation.id}
            />
          </div>
          <div className="field-control">
            <FieldLabel
              htmlFor="new-event-name"
              label="Bezeichnung"
              help="Lesbarer Veranstaltungsname für Administration, Kasse und Anzeigen."
            />
            <input
              id="new-event-name"
              minLength={3}
              onChange={(event) => onSetCreationName(event.target.value)}
              placeholder="Flugtag 2027"
              required
              value={creation.name}
            />
          </div>
          <LocalizedDateInput
            label="Datum"
            labelContent={
              <FieldGroupLabel
                label="Datum"
                help="Veranstaltungstag im deutschen Format TT.MM.JJJJ."
              />
            }
            value={creation.date}
            onChange={onSetCreationDate}
          />
          <div className="field-control">
            <FieldLabel
              htmlFor="new-event-aerodrome"
              label="Flugplatz"
              help="Kurze Flugplatzkennung oder Ortsangabe für die Veranstaltung."
            />
            <input
              id="new-event-aerodrome"
              minLength={2}
              onChange={(event) => onSetCreationAerodrome(event.target.value)}
              placeholder="EDXX"
              required
              value={creation.aerodrome}
            />
          </div>
        </div>
      </section>

      <section className="event-create-section">
        <div className="event-create-section-heading">
          <h3>Datenbasis</h3>
          <p>Bestimmt, ob die neue Veranstaltung vorhandene Stammdaten übernimmt.</p>
        </div>
        <div className="field-control">
          <FieldLabel
            htmlFor="restart-mode"
            label="Datenbasis"
            help="Betriebsdaten wie Tickets, Gruppen, Umläufe und Flugdaten beginnen immer leer."
          />
          <select
            id="restart-mode"
            onChange={(event) =>
              onSetRestartMode(event.target.value as "KEEP_MASTER_DATA" | "EMPTY")
            }
            value={creation.restartMode}
          >
            <option value="KEEP_MASTER_DATA">Stammdaten übernehmen</option>
            <option value="EMPTY">Leer anlegen</option>
          </select>
        </div>
        <p className="help-text event-create-mode-help">{restartModeHelp(creation.restartMode)}</p>
      </section>

      <section className="event-create-section event-create-confirmation">
        <div className="event-create-section-heading">
          <h3>Bestätigung</h3>
          <p>Zum Schutz vor einem versehentlichen Neustart muss NEUSTART eingegeben werden.</p>
        </div>
        <div className="field-control">
          <FieldLabel
            htmlFor="restart-confirmation"
            label="Bestätigungstext"
            help="Exakt NEUSTART in Großbuchstaben eingeben."
          />
          <input
            autoComplete="off"
            id="restart-confirmation"
            onChange={(event) => onSetCreationConfirmation(event.target.value)}
            placeholder="NEUSTART"
            value={creation.confirmation}
          />
        </div>
      </section>

      {creation.error ? <ValidationHint tone="error">{creation.error}</ValidationHint> : null}
    </form>
  );
}

export function EventCreationFooter({
  busyActionKey,
  creation,
  onShowCatalog,
}: Readonly<EventCreationFooterProps>) {
  return (
    <>
      <Button onClick={onShowCatalog} type="button">
        Zurück zu Veranstaltungen
      </Button>
      <Button
        busy={busyActionKey === "create-event"}
        disabled={creation.disabled}
        form="event-create-form"
        type="submit"
        variant="primary"
      >
        Veranstaltung anlegen
      </Button>
    </>
  );
}

export function EventCatalogContent(props: Readonly<EventCatalogDialogProps>) {
  if (props.view === "catalog") return <EventCatalogView {...props} />;
  if (props.view === "create") return <EventCreationForm {...props} />;
  return null;
}
