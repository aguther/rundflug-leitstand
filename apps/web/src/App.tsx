import { APP_NAME, REQUIREMENTS_VERSION } from "@rundflug/config";
import type { EventSnapshot } from "@rundflug/contracts";
import { useEffect, useState } from "react";
import { getDemoSnapshot, getHealth, type HealthResponse } from "./api";

const surfaces = [
  {
    title: "Kasse",
    detail: "Ticketverkauf, Verkaufsprognose und QR-Zuordnung",
    state: "noch nicht implementiert",
  },
  {
    title: "Flight Line",
    detail: "NEXT, IM FLUG, GELANDET und VERFÜGBAR",
    state: "noch nicht implementiert",
  },
  {
    title: "FIDS",
    detail: "Öffentlicher Monitor mit Zeitfenstern und Status",
    state: "noch nicht implementiert",
  },
  {
    title: "Ticketstatus",
    detail: "Öffentliche, nicht aufzählbare QR-Statusseite",
    state: "noch nicht implementiert",
  },
] as const;

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getHealth(controller.signal), getDemoSnapshot(controller.signal)])
      .then(([nextHealth, nextSnapshot]) => {
        setHealth(nextHealth);
        setSnapshot(nextSnapshot);
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name !== "AbortError") {
          setError(reason.message);
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <header className="topbar">
        <div>
          <strong>{APP_NAME}</strong>
          <span>Technischer Repository-Startpunkt</span>
        </div>
        <div className="version">Lastenheft v{REQUIREMENTS_VERSION}</div>
      </header>

      <section className="intro" aria-labelledby="intro-title">
        <div>
          <h1 id="intro-title">Cloudflare-native Grundlage, bewusst noch ohne Fachfunktionen</h1>
          <p>
            Dieses Gerüst beweist Build, PWA-Auslieferung, Worker-API, D1-Anbindung, Durable-Object-
            Koordination, maschinenlesbare Anforderungen und Qualitätsprüfungen. Es täuscht keinen
            produktionsreifen Rundflugbetrieb vor.
          </p>
        </div>
        <div className="system-state" aria-live="polite">
          <span className={health?.ok ? "indicator indicator-ok" : "indicator"} />
          <div>
            <strong>
              {health?.ok
                ? "Worker erreichbar"
                : error
                  ? "Worker nicht erreichbar"
                  : "Prüfe Worker …"}
            </strong>
            <small>
              {health
                ? `${health.environment} · ${health.timestamp}`
                : (error ?? "API-Verbindung wird aufgebaut")}
            </small>
          </div>
        </div>
      </section>

      <section className="surface-grid" aria-label="Geplante Produktoberflächen">
        {surfaces.map((surface) => (
          <article key={surface.title}>
            <div>
              <h2>{surface.title}</h2>
              <p>{surface.detail}</p>
            </div>
            <span>{surface.state}</span>
          </article>
        ))}
      </section>

      <section className="technical-grid">
        <article className="panel">
          <h2>Demo-Veranstaltung aus D1</h2>
          {snapshot ? (
            <dl>
              <div>
                <dt>Name</dt>
                <dd>{snapshot.name}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{snapshot.status}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{snapshot.version}</dd>
              </div>
              <div>
                <dt>Notiz</dt>
                <dd>{snapshot.operationalNote || "–"}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">
              Nach `npm run db:reset:local` wird hier der Seed-Datensatz angezeigt.
            </p>
          )}
        </article>

        <article className="panel">
          <h2>Nächster kontrollierter Schritt</h2>
          <ol>
            <li>`docs/codex/prompts/01-plan-und-traceability.md` in Codex öffnen.</li>
            <li>Offene Fachfragen und ADRs prüfen.</li>
            <li>Erst danach ein Vertical Slice implementieren.</li>
          </ol>
        </article>
      </section>

      <footer>
        Keine flugbetriebliche oder sicherheitsrelevante Freigabewirkung. Nur synthetische Daten im
        Entwicklungsbetrieb.
      </footer>
    </main>
  );
}
