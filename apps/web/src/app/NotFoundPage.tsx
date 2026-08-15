import { ArrowLeft, CalendarDays, Home } from "lucide-react";
import { useEffect } from "react";
import { switchActiveEvent } from "../event-navigation";
import { useAuth } from "../features/auth/AuthContext";
import { AppShell } from "./AppShell";
import { homeForRole } from "./navigation";
import "./not-found-page.css";

export function NotFoundPage() {
  const { session } = useAuth();
  const pathname = window.location.pathname;
  const home = session ? homeForRole(session.account.role) : "/";
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Seite nicht gefunden · Rundflug-Leitstand";
    return () => {
      document.title = previousTitle;
    };
  }, []);
  return (
    <AppShell publicView={!session} title="Seite nicht gefunden">
      <section aria-labelledby="not-found-title" className="not-found-page">
        <div className="not-found-copy">
          <span className="not-found-code">404</span>
          <h1 id="not-found-title">Seite nicht gefunden</h1>
          <p>Der aufgerufene Bereich existiert nicht oder ist nicht mehr verfügbar.</p>
          <code>Pfad: {pathname}</code>
        </div>
        <nav aria-label="Sichere Rückwege" className="not-found-actions">
          <a className="not-found-primary" href={home}>
            <Home aria-hidden="true" size={18} />
            Zur Startseite
          </a>
          {session ? (
            <button onClick={switchActiveEvent} type="button">
              <CalendarDays aria-hidden="true" size={18} />
              Zur Veranstaltungsauswahl
            </button>
          ) : null}
          <button onClick={() => window.history.back()} type="button">
            <ArrowLeft aria-hidden="true" size={18} />
            Zurück
          </button>
        </nav>
      </section>
    </AppShell>
  );
}
