import type { FidsPreferences, PublicBoard } from "@rundflug/contracts";
import { formatBookingGroupLabel } from "@rundflug/domain";
import {
  CircleArrowRight,
  Clock3,
  PlaneTakeoff,
  QrCode,
  Settings,
  TicketsPlane,
  Users,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "./design-system/BrandMark";
import { FidsSettingsDialog } from "./features/fids/FidsSettingsDialog";
import { formatAbsoluteTimeWindow } from "./time-window";

type PublicGroup = PublicBoard["groups"][number];
type EditableFidsPreferences = Pick<FidsPreferences, "visibleRows" | "layout" | "theme">;

const DEFAULT_DEPARTED_VISIBILITY_SECONDS = 15;

function groupCode(group: PublicGroup): string {
  return formatBookingGroupLabel(group.productCode, group.communicationNumber);
}

function groupRowKey(group: PublicGroup): string {
  return JSON.stringify(group);
}

function statusPresentation(status: PublicGroup["status"]): {
  label: string;
  tone: string;
  icon: typeof Clock3;
} {
  if (status === "COME_TO_FLIGHT_LINE")
    return { label: "GO TO GATE", tone: "gate", icon: CircleArrowRight };
  if (status === "BOARDING") return { label: "BOARDING", tone: "boarding", icon: TicketsPlane };
  if (status === "IN_FLIGHT" || status === "LANDED" || status === "COMPLETED") {
    return { label: "ABGEFLOGEN", tone: "departed", icon: PlaneTakeoff };
  }
  if (status === "SERVICE_PAUSED") return { label: "VERZÖGERT", tone: "delayed", icon: Clock3 };
  return { label: "WARTEN", tone: "standby", icon: Clock3 };
}

function timeWindow(group: PublicGroup, timeZone: string): string {
  return formatAbsoluteTimeWindow({
    lowerAt: group.boardingWindowLowerAt,
    upperAt: group.boardingWindowUpperAt,
    timeZone,
    quality: group.predictionQuality,
    phase:
      group.status === "COME_TO_FLIGHT_LINE" || group.status === "BOARDING"
        ? "NOW"
        : ["IN_FLIGHT", "LANDED", "COMPLETED"].includes(group.status)
          ? "FINISHED"
          : "FORECAST",
  });
}

function useVisibleGroups(
  groups: PublicBoard["groups"],
  departedVisibilitySeconds: number,
  visibleRows: number,
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
    return groups
      .filter((group) => {
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
        return now - firstSeen < departedVisibilitySeconds * 1_000;
      })
      .slice(0, visibleRows);
  }, [departedVisibilitySeconds, groups, now, visibleRows]);
}

function Status({ group }: { group: PublicGroup }) {
  const presentation = statusPresentation(group.status);
  const Icon = presentation.icon;
  return (
    <strong className={`fids-status tone-${presentation.tone}`}>
      <Icon aria-hidden="true" className="fids-status-icon" />
      <span>{presentation.label}</span>
    </strong>
  );
}

function GroupCell({ group }: { group: PublicGroup }) {
  return (
    <div className="fids-group-cell">
      <Users aria-hidden="true" />
      <span>
        <strong>{groupCode(group)}</strong>
        <small>{group.productName}</small>
      </span>
    </div>
  );
}

function FidsTable({
  groups,
  compact,
  timeZone,
}: {
  groups: PublicBoard["groups"];
  compact: boolean;
  timeZone: string;
}) {
  return (
    <div className={`fids-table ${compact ? "fids-table--compact" : "fids-table--wide"}`}>
      <div className="fids-grid-head" aria-hidden="true">
        <span>
          {compact ? (
            "Gruppe / Rundflug"
          ) : (
            <>
              <span className="fids-head-wide">Gruppe</span>
              <span className="fids-head-narrow">Gruppe / Rundflug</span>
            </>
          )}
        </span>
        {!compact ? <span>Rundflug</span> : null}
        <span>Gate</span>
        <span>Status</span>
        <span>Zeitfenster</span>
      </div>
      <div className="fids-table-body">
        {groups.map((group) => (
          <div className="fids-row" key={groupRowKey(group)}>
            <GroupCell group={group} />
            {!compact ? <span className="fids-product-cell">{group.productName}</span> : null}
            <span className="fids-gate-cell">{group.gateLabel || "–"}</span>
            <Status group={group} />
            <strong className={`fids-window tone-${statusPresentation(group.status).tone}`}>
              {timeWindow(group, timeZone)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FidsDisplay({
  board,
  error,
  preferences,
  accountCode,
  onSavePreferences,
  onLogout,
}: {
  board: PublicBoard | null;
  error: string | null;
  preferences: FidsPreferences;
  accountCode: string;
  onSavePreferences: (next: EditableFidsPreferences) => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [clock, setClock] = useState(new Date());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const requestedVisibilitySeconds = Number.parseInt(
    new URLSearchParams(window.location.search).get("departedSeconds") ?? "",
    10,
  );
  const departedVisibilitySeconds = Number.isFinite(requestedVisibilitySeconds)
    ? Math.min(900, Math.max(5, requestedVisibilitySeconds))
    : (board?.departedVisibilitySeconds ?? DEFAULT_DEPARTED_VISIBILITY_SECONDS);
  const groups = useVisibleGroups(
    board?.groups ?? [],
    departedVisibilitySeconds,
    preferences.visibleRows,
  );
  const leftColumn = groups.filter((_, index) => index % 2 === 0);
  const rightColumn = groups.filter((_, index) => index % 2 === 1);

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
  const date = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(clock);
  const style = {
    "--fids-single-rows": preferences.visibleRows,
    "--fids-double-rows": Math.ceil(preferences.visibleRows / 2),
  } as CSSProperties;
  const eventName = board?.eventName ?? "Veranstaltung";

  return (
    <main
      className="standard-fids"
      data-fids-layout={preferences.layout.toLowerCase()}
      data-fids-theme={preferences.theme.toLowerCase()}
      data-testid="fids-display"
      style={style}
    >
      <header className="fids-header">
        <div className="standard-mark">
          <BrandMark />
        </div>
        <div className="fids-title">
          <h1>{eventName}</h1>
          <p>{board?.selectedGate ? `Abflugtafel · ${board.selectedGate.label}` : "Abflugtafel"}</p>
        </div>
        <div className="standard-clock">
          <b>{time}</b>
          <span>{date}</span>
          <em className={connected ? "connected" : "offline"}>
            <i aria-hidden="true" /> {connected ? "VERBUNDEN" : "OFFLINE"}
          </em>
        </div>
      </header>

      <section className="fids-board-region" aria-label="Abflugtafel">
        {board?.emergencyMode || board?.operationalInterrupted ? (
          <div className="standard-alert">Der Rundflugbetrieb ist vorübergehend unterbrochen.</div>
        ) : null}
        <div className="fids-single-board">
          <FidsTable
            compact={false}
            groups={groups}
            timeZone={board?.timeZone ?? "Europe/Berlin"}
          />
        </div>
        <div className="fids-double-board">
          <FidsTable compact groups={leftColumn} timeZone={board?.timeZone ?? "Europe/Berlin"} />
          <FidsTable compact groups={rightColumn} timeZone={board?.timeZone ?? "Europe/Berlin"} />
        </div>
        {groups.length === 0 ? (
          <div className="standard-empty">{error ?? "Aktuell keine Gruppen auf der Anzeige."}</div>
        ) : null}
      </section>

      <footer className="fids-footer">
        <div className="fids-footer-copy">
          <span>
            <QrCode aria-hidden="true" /> Bitte QR-Ticket bereithalten
          </span>
          <i aria-hidden="true" />
          <span>Zeitfenster sind Prognosen</span>
        </div>
        <button
          aria-label="FIDS-Einstellungen öffnen"
          className="fids-settings-button"
          onClick={() => setSettingsOpen(true)}
          type="button"
        >
          <Settings aria-hidden="true" />
        </button>
      </footer>

      <FidsSettingsDialog
        accountCode={accountCode}
        eventName={eventName}
        onClose={() => setSettingsOpen(false)}
        onLogout={onLogout}
        onSave={onSavePreferences}
        open={settingsOpen}
        preferences={preferences}
      />
    </main>
  );
}
