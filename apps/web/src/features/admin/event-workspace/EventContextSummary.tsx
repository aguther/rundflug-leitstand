import type { EventSnapshot } from "@rundflug/contracts";
import type { ReactNode } from "react";
import { StatusPill } from "../../../design-system/components";
import { formatGermanDate } from "../../../localized-date-input";

export function eventStatusLabel(status: EventSnapshot["status"]): string {
  if (status === "PREPARATION") return "Vorbereitung";
  if (status === "ACTIVE") return "Aktiv";
  if (status === "CLOSED") return "Geschlossen";
  return "Archiviert";
}

export function EventContextSummary({
  event,
  actions,
}: {
  event: EventSnapshot;
  actions?: ReactNode;
}) {
  return (
    <header className="event-workspace-context">
      <div className="event-workspace-identity">
        <div>
          <span>Veranstaltung</span>
          <h2 title={event.name}>{event.name}</h2>
        </div>
        <StatusPill tone={event.status === "ACTIVE" ? "success" : "neutral"}>
          {eventStatusLabel(event.status)}
        </StatusPill>
      </div>
      <dl className="event-workspace-meta">
        <div>
          <dt>Datum</dt>
          <dd>{formatGermanDate(event.eventDate)}</dd>
        </div>
        <div>
          <dt>Flugplatz</dt>
          <dd>{event.aerodrome || "Nicht angegeben"}</dd>
        </div>
        <div>
          <dt>Zeitzone</dt>
          <dd>{event.timeZone}</dd>
        </div>
      </dl>
      {actions ? <div className="event-workspace-context-actions">{actions}</div> : null}
    </header>
  );
}
