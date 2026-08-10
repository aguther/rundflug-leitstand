import type { EventCatalogEntry, OperationBoard } from "@rundflug/contracts";
import { useCallback, useEffect, useState } from "react";
import { cloneEvent, deleteEvent, downloadMasterDataTemplate, getEventCatalog } from "../../../api";
import { forgetActiveEvent, rememberActiveEvent } from "../../../event-context";
import { ADMIN_DEVICE_ID, deviceTokenFor, EVENT_ID } from "../../../operation-workspace";
import type { EventDialogView, EventSortKey, EventSortState } from "./EventCatalogDialog";

interface UseAdminEventCatalogOptions {
  administrator: boolean;
  board: OperationBoard | null | undefined;
  onMessage: (message: string) => void;
  onViewChange: (view: EventDialogView) => void;
  view: EventDialogView;
}

const eventCatalogCollator = new Intl.Collator("de-DE", {
  numeric: true,
  sensitivity: "base",
});

export function useAdminEventCatalog({
  administrator,
  board,
  onMessage,
  onViewChange,
  view,
}: UseAdminEventCatalogOptions) {
  const [events, setEvents] = useState<EventCatalogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<EventSortState>({ key: "eventDate", direction: null });
  const [eventId, setEventId] = useState("");
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [aerodrome, setAerodrome] = useState("");
  const [restartMode, setRestartMode] = useState<"KEEP_MASTER_DATA" | "EMPTY">("KEEP_MASTER_DATA");
  const [confirmation, setConfirmation] = useState("");
  const [creationError, setCreationError] = useState<string | null>(null);

  const refreshEvents = useCallback(async () => {
    if (!administrator) return;
    try {
      const catalog = await getEventCatalog(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setEvents(catalog.events);
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : "Veranstaltungen nicht verfügbar.");
    }
  }, [administrator, onMessage]);

  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents]);

  async function exportTemplate() {
    await downloadMasterDataTemplate(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID));
    onMessage("Stammdatenvorlage wurde als versionierte JSON-Datei exportiert.");
  }

  async function createEvent() {
    setCreationError(null);
    try {
      const result = await cloneEvent(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID), {
        commandId: crypto.randomUUID(),
        expectedSourceVersion: board?.event.version ?? 0,
        eventId,
        name,
        eventDate,
        aerodrome,
        timeZone: board?.event.timeZone ?? "Europe/Berlin",
        restartMode,
      });
      rememberActiveEvent(window.localStorage, result.eventId);
      window.location.assign(`/admin?event=${encodeURIComponent(result.eventId)}`);
    } catch (cause) {
      setCreationError(
        cause instanceof Error ? cause.message : "Veranstaltung konnte nicht angelegt werden.",
      );
    }
  }

  async function removeEvent(entry: EventCatalogEntry) {
    const deletionConfirmation = window.prompt(
      `„${entry.name}“ wird vollständig gelöscht. Zum Bestätigen exakt „${entry.eventId}“ eingeben:`,
    );
    if (deletionConfirmation !== entry.eventId) return;
    const reason = window.prompt("Kurze Begründung für die Löschung:")?.trim() ?? "";
    if (reason.length < 3) {
      onMessage("Die Löschung benötigt eine Begründung mit mindestens drei Zeichen.");
      return;
    }
    try {
      const result = await deleteEvent(
        EVENT_ID,
        entry.eventId,
        entry.version,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        reason,
      );
      if (entry.eventId === EVENT_ID) {
        forgetActiveEvent(window.localStorage);
        window.location.assign(result.setupRequired ? "/setup" : "/");
        return;
      }
      onMessage(
        result.assetCleanupPending
          ? "Veranstaltung gelöscht; die Logo-Bereinigung wird erneut versucht."
          : "Veranstaltung vollständig gelöscht.",
      );
      await refreshEvents();
    } catch (cause) {
      onMessage(
        cause instanceof Error ? cause.message : "Veranstaltung konnte nicht gelöscht werden.",
      );
    }
  }

  const normalizedSearch = search.trim().toLocaleLowerCase("de-DE");
  const filteredEvents = events.filter((entry) =>
    `${entry.name} ${entry.eventId} ${entry.eventDate} ${entry.aerodrome}`
      .toLocaleLowerCase("de-DE")
      .includes(normalizedSearch),
  );
  const visibleEvents =
    sort.direction === null
      ? filteredEvents
      : filteredEvents.toSorted((left, right) => {
          const comparison = eventCatalogCollator.compare(
            String(left[sort.key]),
            String(right[sort.key]),
          );
          return sort.direction === "asc" ? comparison : -comparison;
        });

  function toggleSort(key: EventSortKey) {
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction:
              current.direction === "asc" ? "desc" : current.direction === "desc" ? null : "asc",
          }
        : { key, direction: "asc" },
    );
  }

  function openCreation() {
    setRestartMode("EMPTY");
    setConfirmation("");
    setCreationError(null);
    onViewChange("create");
  }

  function closeDialog() {
    onViewChange("closed");
    setCreationError(null);
  }

  return {
    closeDialog,
    createEvent,
    creation: {
      aerodrome,
      confirmation,
      date: eventDate,
      disabled:
        !administrator ||
        confirmation !== "NEUSTART" ||
        !/^[a-z0-9-]{3,64}$/.test(eventId.trim()) ||
        name.trim().length < 3 ||
        !eventDate ||
        aerodrome.trim().length < 2,
      error: creationError,
      id: eventId,
      name,
      restartMode,
    },
    exportTemplate,
    openCreation,
    refreshEvents,
    removeEvent,
    search,
    setAerodrome,
    setConfirmation,
    setEventDate,
    setEventId,
    setName,
    setRestartMode,
    setSearch,
    showCatalog: () => onViewChange("catalog"),
    sort,
    toggleSort,
    view,
    visibleEvents,
  };
}
