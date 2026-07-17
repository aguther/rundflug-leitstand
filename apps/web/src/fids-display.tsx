import type { PublicBoard } from "@rundflug/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "./design-system/BrandMark";
import { ThemeToggle } from "./design-system/ThemeToggle";

type DisplayMode = "standard" | "terminal";
type PublicGroup = PublicBoard["groups"][number];

const DEFAULT_DEPARTED_VISIBILITY_MINUTES = 5;

function groupCode(group: PublicGroup): string {
  return `${group.productCode}-${String(group.communicationNumber).padStart(3, "0")}`;
}

function standardStatus(status: PublicGroup["status"]): string {
  if (status === "COME_TO_FLIGHT_LINE") return "GO TO GATE";
  if (status === "BOARDING") return "BOARDING";
  if (status === "IN_FLIGHT") return "ABGEFLOGEN";
  if (status === "LANDED") return "GELANDET";
  if (status === "COMPLETED") return "ABGEFLOGEN";
  if (status === "SERVICE_PAUSED") return "VERZÖGERT";
  return "WARTEN";
}

function terminalStatus(status: PublicGroup["status"]): string {
  if (status === "COME_TO_FLIGHT_LINE") return "GO TO GATE";
  if (status === "BOARDING") return "BOARDING";
  if (status === "IN_FLIGHT" || status === "LANDED" || status === "COMPLETED") return "DEPARTED";
  if (status === "SERVICE_PAUSED") return "DELAYED";
  return "WAITING";
}

function statusTone(status: PublicGroup["status"]): string {
  if (status === "COME_TO_FLIGHT_LINE") return "gate";
  if (status === "BOARDING") return "boarding";
  if (status === "IN_FLIGHT" || status === "LANDED" || status === "COMPLETED") return "departed";
  if (status === "SERVICE_PAUSED") return "delayed";
  return "standby";
}

function standardWindow(group: PublicGroup): string {
  if (group.status === "COME_TO_FLIGHT_LINE") return "Jetzt";
  if (group.status === "BOARDING") return "Jetzt";
  if (group.status === "COMPLETED") return "–";
  if (group.status === "SERVICE_PAUSED") return "neues Fenster folgt";
  return `ca. ${group.waitLowerMinutes}–${group.waitUpperMinutes} Min.`;
}

function terminalWindow(group: PublicGroup): string {
  if (group.status === "COME_TO_FLIGHT_LINE") return "NOW";
  if (group.status === "BOARDING") return "NOW";
  if (group.status === "COMPLETED") return "–";
  if (group.status === "SERVICE_PAUSED") return "NEW WINDOW TO FOLLOW";
  return `APPROX. ${group.waitLowerMinutes}–${group.waitUpperMinutes} MIN.`;
}

function terminalFlightName(name: string): string {
  return /oldtimer|vintage/i.test(name) ? "VINTAGE FLIGHT" : "SCENIC FLIGHT";
}

function terminalGate(label: string): string {
  return label
    .replace(/Eingang Halle/gi, "HALL ENTRANCE")
    .replace(/Halle/gi, "HALL")
    .replace(/Eingang/gi, "ENTRANCE")
    .replace(/Vor(?:feld)? Nord/gi, "NORTH APRON");
}

function useVisibleGroups(
  groups: PublicBoard["groups"],
  departedVisibilityMinutes: number,
): PublicBoard["groups"] {
  const locallyObservedDeparture = useRef(new Map<string, number>());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return useMemo(() => {
    const currentCodes = new Set(groups.map(groupCode));
    for (const code of locallyObservedDeparture.current.keys()) {
      if (!currentCodes.has(code)) locallyObservedDeparture.current.delete(code);
    }
    return groups.filter((group) => {
      const code = groupCode(group);
      if (!["IN_FLIGHT", "LANDED", "COMPLETED"].includes(group.status)) {
        locallyObservedDeparture.current.delete(code);
        return true;
      }
      const persistedDeparture = group.departedAt ? Date.parse(group.departedAt) : Number.NaN;
      const firstSeen = Number.isFinite(persistedDeparture)
        ? persistedDeparture
        : (locallyObservedDeparture.current.get(code) ?? now);
      locallyObservedDeparture.current.set(code, firstSeen);
      return now - firstSeen < departedVisibilityMinutes * 60_000;
    });
  }, [departedVisibilityMinutes, groups, now]);
}

export function FidsDisplay({
  board,
  error,
  mode,
}: {
  board: PublicBoard | null;
  error: string | null;
  mode: DisplayMode;
}) {
  const [clock, setClock] = useState(new Date());
  const requestedVisibility = Number.parseInt(
    new URLSearchParams(window.location.search).get("departedMinutes") ?? "",
    10,
  );
  const departedVisibilityMinutes = Number.isFinite(requestedVisibility)
    ? Math.min(15, Math.max(1, requestedVisibility))
    : DEFAULT_DEPARTED_VISIBILITY_MINUTES;
  const groups = useVisibleGroups(board?.groups ?? [], departedVisibilityMinutes);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const connected = Boolean(board) && !error;
  const time = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(clock);
  const date = new Intl.DateTimeFormat(mode === "terminal" ? "en-GB" : "de-DE", {
    day: "2-digit",
    month: mode === "terminal" ? "short" : "long",
    year: "numeric",
  }).format(clock);

  if (mode === "terminal") {
    return (
      <main className="terminal-fids" data-display-mode="terminal">
        <header>
          <div className="terminal-mark">
            <BrandMark />
          </div>
          <div className="terminal-title">
            <h1>RUNDFLUG-LEITSTAND</h1>
            <strong>DEPARTURES</strong>
          </div>
          <div className="terminal-clock">
            <b>{time}</b>
            <span>{date.toUpperCase()}</span>
            <em className={connected ? "connected" : "offline"}>
              ● {connected ? "CONNECTED" : "OFFLINE"}
            </em>
          </div>
        </header>
        <nav className="fids-mode-switch" aria-label="Display style">
          <a href="/fids?kiosk=1">STANDARD</a>
          <a aria-current="page" href="/fids/terminal?kiosk=1">
            TERMINAL
          </a>
          <ThemeToggle />
        </nav>
        {board?.emergencyMode || board?.operationalInterrupted ? (
          <div className="terminal-alert">OPERATIONS TEMPORARILY SUSPENDED</div>
        ) : null}
        <section className="terminal-grid" aria-label="Departures">
          <div className="terminal-grid-head">
            <span>GROUP</span>
            <span>FLIGHT</span>
            <span>GATE</span>
            <span>STATUS</span>
            <span>TIME WINDOW</span>
          </div>
          {groups.map((group) => (
            <div className="terminal-row" key={groupCode(group)}>
              <strong>{groupCode(group)}</strong>
              <span>{terminalFlightName(group.productName)}</span>
              <span>{terminalGate(group.gateLabel).toUpperCase()}</span>
              <b className={`tone-${statusTone(group.status)}`}>{terminalStatus(group.status)}</b>
              <span>{terminalWindow(group)}</span>
            </div>
          ))}
          {groups.length === 0 ? (
            <div className="terminal-empty">NO DEPARTURES CURRENTLY DISPLAYED</div>
          ) : null}
        </section>
        <footer>
          ▣ &nbsp; PLEASE KEEP YOUR QR TICKET READY &nbsp; • &nbsp; TIME WINDOWS ARE ESTIMATES
        </footer>
      </main>
    );
  }

  return (
    <main className="standard-fids" data-display-mode="standard">
      <header>
        <div className="standard-mark">
          <BrandMark />
        </div>
        <div>
          <h1>Rundflug-Leitstand</h1>
          <p>Abflugtafel</p>
        </div>
        <div className="standard-clock">
          <b>{time}</b>
          <span>{date}</span>
          <em className={connected ? "connected" : "offline"}>
            ● {connected ? "VERBUNDEN" : "OFFLINE"}
          </em>
        </div>
      </header>
      <nav className="fids-mode-switch" aria-label="Darstellungsstil">
        <a aria-current="page" href="/fids?kiosk=1">
          Standard
        </a>
        <a href="/fids/terminal?kiosk=1">Terminal</a>
        <ThemeToggle />
      </nav>
      {board?.emergencyMode || board?.operationalInterrupted ? (
        <div className="standard-alert">Der Rundflugbetrieb ist vorübergehend unterbrochen.</div>
      ) : null}
      <section className="standard-grid" aria-label="Abflugtafel">
        <div className="standard-grid-head">
          <span>Gruppe</span>
          <span>Rundflug</span>
          <span>Gate</span>
          <span>Status</span>
          <span>Zeitfenster</span>
        </div>
        {groups.map((group) => (
          <div className="standard-row" key={groupCode(group)}>
            <strong>{groupCode(group)}</strong>
            <span>{group.productName}</span>
            <span>{group.gateLabel}</span>
            <b className={`tone-${statusTone(group.status)}`}>{standardStatus(group.status)}</b>
            <span>{standardWindow(group)}</span>
          </div>
        ))}
        {groups.length === 0 ? (
          <div className="standard-empty">Aktuell keine Gruppen auf der Anzeige.</div>
        ) : null}
      </section>
      <footer>
        ⌁ &nbsp; Bitte QR-Ticket bereithalten &nbsp; • &nbsp; Zeitfenster sind Prognosen
      </footer>
    </main>
  );
}
