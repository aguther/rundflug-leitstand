import type { EventCatalogEntry, OperatorSession } from "@rundflug/contracts";
import { useState } from "react";
import { BrandMark } from "../../design-system/BrandMark";
import { Button } from "../../design-system/components";
import { ThemeToggle } from "../../design-system/ThemeToggle";
import { rememberActiveEvent } from "../../event-context";
import { useAuth } from "./AuthContext";
import "./login.css";

const statusLabels: Record<string, string> = {
  ACTIVE: "Aktiv",
  PREPARATION: "Vorbereitung",
  COMPLETED: "Abgeschlossen",
};

export function EventSelectionPage({
  events,
  session,
}: {
  events: EventCatalogEntry[];
  session: OperatorSession;
}) {
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
    const url = new URL(window.location.href);
    url.searchParams.delete("event");
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <main className="login-page event-selection-page">
      <header className="login-topbar">
        <a className="app-brand" href="/" aria-label="Rundflug-Leitstand">
          <BrandMark />
          <strong>Rundflug-Leitstand</strong>
        </a>
        <ThemeToggle />
      </header>
      <section className="login-panel" aria-labelledby="event-selection-title">
        <div className="login-heading">
          <BrandMark />
          <div>
            <span className="eyebrow">{session.account.loginCode}</span>
            <h1 id="event-selection-title">Veranstaltung auswählen</h1>
            <p>Der Arbeitsplatz wird eindeutig mit dem gewählten Veranstaltungstag geöffnet.</p>
          </div>
        </div>
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
                  {entry.name} ·{" "}
                  {new Date(`${entry.eventDate}T12:00:00`).toLocaleDateString("de-DE")}
                  {entry.aerodrome ? ` · ${entry.aerodrome}` : ""} ·{" "}
                  {statusLabels[entry.status] ?? entry.status}
                </option>
              ))}
            </select>
            <button className="login-submit" disabled={!eventId} type="submit">
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
      </section>
    </main>
  );
}
