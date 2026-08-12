import type { EventCatalogEntry } from "@rundflug/contracts";
import { Plus, Trash2 } from "lucide-react";
import { ValidationHint } from "../../../admin-ux";
import {
  Button,
  ModalDialog,
  PageHeader,
  Panel,
  SearchField,
} from "../../../design-system/components";
import { formatGermanDate, LocalizedDateInput } from "../../../localized-date-input";
import { FieldGroupLabel, FieldLabel } from "../../../operation-workspace";

export type EventDialogView = "closed" | "catalog" | "create";
export type EventSortKey = "name" | "eventDate" | "status" | "aerodrome";

export interface EventSortState {
  direction: "asc" | "desc" | null;
  key: EventSortKey;
}

export interface EventCreationDraft {
  aerodrome: string;
  confirmation: string;
  date: string;
  disabled: boolean;
  error: string | null;
  id: string;
  name: string;
  restartMode: "KEEP_MASTER_DATA" | "EMPTY";
}

export interface EventCatalogDialogProps {
  busyActionKey: string | null;
  canExport: boolean;
  canManage: boolean;
  creation: EventCreationDraft;
  currentEventId: string;
  currentEventName: string;
  currentStep: string;
  events: EventCatalogEntry[];
  onClose: () => void;
  onCreateSubmit: () => void;
  onDelete: (entry: EventCatalogEntry) => void;
  onExport: () => void;
  onImport: () => void;
  onOpenCreate: () => void;
  onSearchChange: (value: string) => void;
  onSetCreationAerodrome: (value: string) => void;
  onSetCreationConfirmation: (value: string) => void;
  onSetCreationDate: (value: string) => void;
  onSetCreationId: (value: string) => void;
  onSetCreationName: (value: string) => void;
  onSetRestartMode: (value: "KEEP_MASTER_DATA" | "EMPTY") => void;
  onShowCatalog: () => void;
  onSort: (key: EventSortKey) => void;
  search: string;
  sort: EventSortState;
  view: EventDialogView;
}

export function EventCatalogDialog({
  busyActionKey,
  canExport,
  canManage,
  creation,
  currentEventId,
  currentEventName,
  currentStep,
  events,
  onClose,
  onCreateSubmit,
  onDelete,
  onExport,
  onImport,
  onOpenCreate,
  onSearchChange,
  onSetCreationAerodrome,
  onSetCreationConfirmation,
  onSetCreationDate,
  onSetCreationId,
  onSetCreationName,
  onSetRestartMode,
  onShowCatalog,
  onSort,
  search,
  sort,
  view,
}: Readonly<EventCatalogDialogProps>) {
  return (
    <ModalDialog
      bodyClassName={view === "create" ? "event-create-dialog-body" : "event-catalog-dialog-body"}
      closeLabel={
        view === "create" ? "Veranstaltungsanlage schließen" : "Veranstaltungsverwaltung schließen"
      }
      className="event-catalog-dialog"
      description={
        view === "create"
          ? "Veranstaltungsdaten, Datenbasis und Bestätigung in einem Schritt erfassen."
          : "Veranstaltung auswählen, neu anlegen oder Stammdaten übertragen."
      }
      footer={
        view === "create" ? (
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
        ) : undefined
      }
      footerClassName="event-create-dialog-footer"
      {...(view === "create" ? { initialFocusSelector: "#new-event-id" } : {})}
      onClose={onClose}
      open={view !== "closed"}
      size="wide"
      title={view === "create" ? "Neue Veranstaltung anlegen" : "Veranstaltungen verwalten"}
    >
      {view === "catalog" ? (
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
                <Button
                  disabled={!canManage}
                  onClick={onOpenCreate}
                  size="compact"
                  variant="primary"
                >
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
                  {(
                    [
                      ["name", "Veranstaltungsname"],
                      ["eventDate", "Datum"],
                      ["status", "Phase"],
                      ["aerodrome", "Flugplatz"],
                    ] as const
                  ).map(([key, label]) => (
                    <th
                      aria-sort={
                        sort.key === key && sort.direction
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      key={key}
                    >
                      <button
                        className="admin-sort-button"
                        onClick={() => onSort(key)}
                        type="button"
                      >
                        {label}
                        <span aria-hidden="true">
                          {sort.key === key && sort.direction
                            ? sort.direction === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
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
                    <td>
                      {entry.status === "PREPARATION"
                        ? "Vorbereitung"
                        : entry.status === "ACTIVE"
                          ? "Aktiv"
                          : entry.status === "CLOSED"
                            ? "Geschlossen"
                            : "Archiviert"}
                    </td>
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
      ) : view === "create" ? (
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
            <p className="help-text event-create-mode-help">
              {creation.restartMode === "KEEP_MASTER_DATA"
                ? "Übernommen werden Parameter, Gates, Ressourcengruppen, Produkte, Flugzeugzuordnungen und Piloten-IDs. Verkäufe bleiben zunächst gesperrt."
                : "Nur Veranstaltungsdaten, Grundeinstellungen und das erste Administrationskonto werden angelegt. Alle Stammdaten beginnen leer."}
            </p>
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
      ) : null}
    </ModalDialog>
  );
}
