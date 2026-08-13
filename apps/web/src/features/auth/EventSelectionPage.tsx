import type { EventCatalogEntry, OperatorSession } from "@rundflug/contracts";
import { useState } from "react";
import { Button } from "../../design-system/components";
import { rememberActiveEvent } from "../../event-context";
import { reloadAtEventSelectionLocation } from "../../event-navigation";
import { AccessPageFrame } from "./AccessPageFrame";
import { useAuth } from "./AuthContext";

const statusLabels: Record<string, string> = {
  ACTIVE: "Aktiv",
  PREPARATION: "Vorbereitung",
  COMPLETED: "Abgeschlossen",
};

export function EventSelectionPage({
  events,
  session,
}: Readonly<{
  events: EventCatalogEntry[];
  session: OperatorSession;
}>) {
  const { logout } = useAuth();
  const [eventId, setEventId] = useState(events.length === 1 ? (events[0]?.eventId ?? "") : "");
  const [logoutBusy, setLogoutBusy] = useState(false);

  async function logoutAndReload() {
    setLogoutBusy(true);
    try {
      await logout();
      window.location.reload();
    } finally {
      setLogoutBusy(false);
    }
  }

  function openEvent(event: React.FormEvent) {
    event.preventDefault();
    const selected = events.find((entry) => entry.eventId === eventId);
    if (!selected) return;
    rememberActiveEvent(window.localStorage, selected.eventId, selected.name);
    reloadAtEventSelectionLocation(window.location, window.history);
  }

  return (
    <AccessPageFrame
      className="event-selection-page"
      description="Der Arbeitsplatz wird eindeutig mit dem gewählten Veranstaltungstag geöffnet."
      eyebrow={session.account.loginCode}
      title="Veranstaltung auswählen"
      titleId="event-selection-title"
    >
      {events.length > 0 ? (
        <form onSubmit={openEvent}>
          <label htmlFor="login-event">Veranstaltung</label>
          <select
            id="login-event"
            onChange={(event) => setEventId(event.target.value)}
            value={eventId}
          >
            <option value="">Veranstaltung auswählen</option>
            {events.map((entry) => (
              <option key={entry.eventId} value={entry.eventId}>
                {entry.name} · {new Date(`${entry.eventDate}T12:00:00`).toLocaleDateString("de-DE")}
                {entry.aerodrome ? ` · ${entry.aerodrome}` : ""} ·{" "}
                {statusLabels[entry.status] ?? entry.status}
              </option>
            ))}
          </select>
          <button className="access-page-submit" disabled={!eventId} type="submit">
            Veranstaltung öffnen
          </button>
        </form>
      ) : (
        <p className="login-message login-message-error" role="alert">
          Keine aktive oder vorbereitete Veranstaltung verfügbar.
        </p>
      )}
      <Button
        busy={logoutBusy}
        className="event-selection-logout"
        onClick={() => void logoutAndReload()}
        type="button"
        variant="ghost"
      >
        Mit anderem Konto anmelden
      </Button>
    </AccessPageFrame>
  );
}
