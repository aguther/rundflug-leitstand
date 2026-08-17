import type { EventCatalogEntry } from "@rundflug/contracts";
import { ModalDialog } from "../../../design-system/components";
import { EventCatalogContent, EventCreationFooter } from "./EventCatalogDialogContent";

export type EventDialogView = "closed" | "catalog" | "create";
export type EventSortKey = "name" | "eventDate" | "status" | "aerodrome";

export interface EventSortState {
  direction: "asc" | "desc" | null;
  key: EventSortKey;
}

export interface EventCreationDraft {
  aerodrome: string;
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

interface EventDialogPresentation {
  bodyClassName: string;
  closeLabel: string;
  description: string;
  initialFocusSelector?: string;
  title: string;
}

const CATALOG_PRESENTATION: EventDialogPresentation = {
  bodyClassName: "event-catalog-dialog-body",
  closeLabel: "Veranstaltungsverwaltung schließen",
  description: "Veranstaltung auswählen, neu anlegen oder Stammdaten übertragen.",
  title: "Veranstaltungen verwalten",
};

const CREATION_PRESENTATION: EventDialogPresentation = {
  bodyClassName: "event-create-dialog-body",
  closeLabel: "Veranstaltungsanlage schließen",
  description: "Veranstaltungsdaten und Datenbasis in einem Schritt erfassen.",
  initialFocusSelector: "#new-event-id",
  title: "Neue Veranstaltung anlegen",
};

function dialogPresentation(view: EventDialogView) {
  return view === "create" ? CREATION_PRESENTATION : CATALOG_PRESENTATION;
}

function dialogFooter(props: Readonly<EventCatalogDialogProps>) {
  if (props.view !== "create") return undefined;
  return (
    <EventCreationFooter
      busyActionKey={props.busyActionKey}
      creation={props.creation}
      onShowCatalog={props.onShowCatalog}
    />
  );
}

export function EventCatalogDialog(props: Readonly<EventCatalogDialogProps>) {
  const presentation = dialogPresentation(props.view);
  return (
    <ModalDialog
      bodyClassName={presentation.bodyClassName}
      closeLabel={presentation.closeLabel}
      className="event-catalog-dialog"
      description={presentation.description}
      footer={dialogFooter(props)}
      footerClassName="event-create-dialog-footer"
      {...(presentation.initialFocusSelector
        ? { initialFocusSelector: presentation.initialFocusSelector }
        : {})}
      onClose={props.onClose}
      open={props.view !== "closed"}
      size="wide"
      title={presentation.title}
    >
      <EventCatalogContent {...props} />
    </ModalDialog>
  );
}
