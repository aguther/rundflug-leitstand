import type { PublicGroupStatus, PublicTicketStatus } from "@rundflug/contracts";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CircleArrowRight,
  CircleCheck,
  Clock3,
  MapPin,
  PlaneLanding,
  PlaneTakeoff,
  RefreshCw,
  Ticket,
  TicketsPlane,
  Users,
} from "lucide-react";
import { formatAbsoluteTimeWindow } from "../../time-window";
import {
  PUBLIC_STATUS_PRESENTATIONS,
  type PublicStatus,
  type PublicStatusIconName,
  publicStatusMessage,
} from "./public-status-model";

const STATUS_ICONS: Record<PublicStatusIconName, LucideIcon> = {
  Clock3,
  CircleArrowRight,
  TicketsPlane,
  PlaneTakeoff,
  PlaneLanding,
  CircleCheck,
};

interface StatusPart {
  status: PublicStatus;
  message: string;
  gateLabel: string;
  boardingWindowLowerAt: string | null;
  boardingWindowUpperAt: string | null;
  predictionQuality: "STABLE" | "CHANGING" | "UNCERTAIN";
}

function statusWindow(part: StatusPart, timeZone: string): string {
  return formatAbsoluteTimeWindow({
    lowerAt: part.boardingWindowLowerAt,
    upperAt: part.boardingWindowUpperAt,
    timeZone,
    quality: part.predictionQuality,
    phase:
      part.status === "COME_TO_FLIGHT_LINE" || part.status === "BOARDING"
        ? "NOW"
        : ["IN_FLIGHT", "LANDED", "COMPLETED"].includes(part.status)
          ? "FINISHED"
          : "FORECAST",
  });
}

export function PublicStatusIdentity({
  bookingGroupLabel,
  productName,
  passengerCount,
}: {
  bookingGroupLabel: string;
  productName: string;
  passengerCount?: number;
}) {
  return (
    <div className="public-status-summary">
      <div className="public-status-identity">
        <Ticket aria-hidden="true" />
        <div>
          <span>Gruppe {bookingGroupLabel}</span>
          <h1>{productName}</h1>
          {passengerCount ? (
            <small>
              {passengerCount} Person{passengerCount === 1 ? "" : "en"}
            </small>
          ) : null}
        </div>
      </div>
      <div className="public-status-live" role="status">
        <span>
          <RefreshCw aria-hidden="true" />
          Live
        </span>
        <small>Verbindung stabil</small>
      </div>
    </div>
  );
}

export function PublicStatusPart({
  part,
  timeZone,
  partNumber,
  partCount,
  passengerCount,
  pauseReason,
}: {
  part: StatusPart;
  timeZone: string;
  partNumber?: number;
  partCount?: number;
  passengerCount?: number;
  pauseReason?: string;
}) {
  const presentation = PUBLIC_STATUS_PRESENTATIONS[part.status];
  const StatusIcon = STATUS_ICONS[presentation.iconName];
  const multipleParts = Boolean(partCount && partCount > 1 && partNumber && passengerCount);
  return (
    <article className="public-status-part" data-status={part.status}>
      {multipleParts ? (
        <header className="public-status-part-header">
          <strong>
            Teilflug {partNumber} von {partCount}
          </strong>
          <span>
            <Users aria-hidden="true" />
            {passengerCount} Person{passengerCount === 1 ? "" : "en"}
          </span>
        </header>
      ) : null}
      <section className="public-status-current">
        <span className="public-status-eyebrow">Aktueller Status</span>
        <div className="public-status-action">
          <StatusIcon aria-hidden="true" />
          <strong>{presentation.label}</strong>
        </div>
        <p>{publicStatusMessage(part.status, part.message, pauseReason)}</p>
      </section>
      <dl className="public-status-details">
        <div>
          <dt>
            <MapPin aria-hidden="true" />
            Gate
          </dt>
          <dd>{part.gateLabel || "–"}</dd>
        </div>
        <div>
          <dt>
            <Clock3 aria-hidden="true" />
            Geschätztes Zeitfenster
          </dt>
          <dd>{statusWindow(part, timeZone)}</dd>
        </div>
      </dl>
    </article>
  );
}

export function PublicStatusFooter({
  updatedAt,
  timeZone,
  push,
  pushDescription,
}: {
  updatedAt: string;
  timeZone: string;
  push: ReturnType<typeof import("./use-public-push").usePublicPush>;
  pushDescription: string;
}) {
  return (
    <footer className="public-status-footer">
      <div className="public-status-updated">
        <Clock3 aria-hidden="true" />
        <span>
          Zuletzt aktualisiert{" "}
          <strong>
            {new Date(updatedAt).toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone,
            })}
          </strong>
        </span>
      </div>
      <label className="public-push-toggle">
        <Bell aria-hidden="true" />
        <span>
          <strong>Benachrichtigungen</strong>
          <small>{pushDescription}</small>
        </span>
        <input
          checked={push.enabled}
          disabled={push.disabled}
          onChange={(event) => void push.change(event.target.checked)}
          type="checkbox"
        />
      </label>
      {push.message ? (
        <p className="public-push-message" role="status">
          {push.message}
        </p>
      ) : null}
      <a className="public-privacy-link" href="/datenschutz">
        Datenschutz
      </a>
    </footer>
  );
}

export type TicketStatusPart = Pick<
  PublicTicketStatus,
  | "status"
  | "message"
  | "gateLabel"
  | "boardingWindowLowerAt"
  | "boardingWindowUpperAt"
  | "predictionQuality"
>;

export type GroupStatusPart = PublicGroupStatus["parts"][number];
