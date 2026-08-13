import type {
  BookingGroupPartContext,
  PublicGroupStatus,
  PublicTicketStatus,
  TicketGroupRecallProjection,
} from "@rundflug/contracts";
import { formatBookingGroupPart, isSplitBookingGroupPart } from "@rundflug/domain";
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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ModalDialog } from "../../design-system/components";
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

function AutoFitText({ children }: Readonly<{ children: string }>) {
  const textRef = useRef<HTMLSpanElement>(null);
  const text = children;

  useLayoutEffect(() => {
    const element = textRef.current;
    if (element?.textContent !== text) return;
    element.style.removeProperty("font-size");
    const baseFontSize = Number.parseFloat(getComputedStyle(element).fontSize);
    let lastWidth = -1;
    let stopped = false;

    const fit = (force = false) => {
      const availableWidth = element.clientWidth;
      if (!availableWidth || (!force && Math.abs(availableWidth - lastWidth) < 0.5)) return;
      lastWidth = availableWidth;
      element.style.fontSize = `${baseFontSize}px`;
      const requiredWidth = element.scrollWidth;
      if (requiredWidth > availableWidth) {
        element.style.fontSize = `${Math.max(1, baseFontSize * (availableWidth / requiredWidth))}px`;
      }
    };

    const observer = new ResizeObserver(() => fit());
    observer.observe(element);
    fit(true);
    void document.fonts?.ready.then(() => {
      if (!stopped) fit(true);
    });

    return () => {
      stopped = true;
      observer.disconnect();
    };
  }, [text]);

  return (
    <span className="public-fit-text" ref={textRef}>
      {children}
    </span>
  );
}

interface StatusPart {
  status: PublicStatus;
  message: string;
  gateLabel: string;
  boardingWindowLowerAt: string | null;
  boardingWindowUpperAt: string | null;
  predictionQuality: "STABLE" | "CHANGING" | "UNCERTAIN";
  forecastState: "DISPATCH_WINDOW" | "LONG_RANGE_WINDOW" | "AFTER_OPERATIONS_END" | "UNAVAILABLE";
  forecastReason:
    | "RETURN_TIME_UNKNOWN"
    | "NO_MATCHING_CAPACITY"
    | "STATUS_CLARIFICATION"
    | "OPERATIONS_INTERRUPTED"
    | "EMERGENCY_MODE"
    | "RESOURCE_GROUP_UNAVAILABLE"
    | null;
}

function publicForecastPhase(part: StatusPart): "NOW" | "FINISHED" | "FORECAST" {
  if (part.status === "COME_TO_FLIGHT_LINE" || part.status === "BOARDING") return "NOW";
  if (["IN_FLIGHT", "LANDED", "COMPLETED"].includes(part.status)) return "FINISHED";
  return "FORECAST";
}

function statusWindow(part: StatusPart, timeZone: string): string {
  if (part.forecastState === "AFTER_OPERATIONS_END") {
    return "Voraussichtlich heute nicht mehr";
  }
  if (part.forecastState === "UNAVAILABLE") {
    if (part.forecastReason === "RETURN_TIME_UNKNOWN") return "Rückkehrzeit offen";
    if (part.forecastReason === "NO_MATCHING_CAPACITY") return "Keine passende Kapazität";
    if (part.forecastReason === "STATUS_CLARIFICATION") return "Status wird geklärt";
    return "Wird aktualisiert";
  }
  return formatAbsoluteTimeWindow({
    lowerAt: part.boardingWindowLowerAt,
    upperAt: part.boardingWindowUpperAt,
    timeZone,
    quality: part.predictionQuality,
    phase: publicForecastPhase(part),
  });
}

export function PublicStatusIdentity({
  bookingGroupLabel,
  productName,
  passengerCount,
}: Readonly<{
  bookingGroupLabel: string;
  productName: string;
  passengerCount?: number;
}>) {
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
      <output className="public-status-live">
        <span>
          <RefreshCw aria-hidden="true" />
          Live
        </span>
        <small>Verbindung stabil</small>
      </output>
    </div>
  );
}

export function PublicRecallNotice({
  recall,
}: Readonly<{ recall: TicketGroupRecallProjection | null }>) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!recall) return;
    const remaining = Date.parse(recall.expiresAt) - Date.now();
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(remaining + 25, 300_025)),
    );
    return () => window.clearTimeout(timer);
  }, [recall]);

  if (!recall || Date.parse(recall.expiresAt) <= now) return null;
  return (
    <aside aria-live="assertive" className="public-recall-notice" role="status">
      <span aria-hidden="true" className="public-recall-bell">
        <Bell />
      </span>
      <div>
        <strong>Nachruf aktiv</strong>
        <p>{recall.publicMessage}</p>
      </div>
    </aside>
  );
}

export function PublicStatusPart({
  part,
  timeZone,
  bookingGroupPart,
  pauseReason,
}: Readonly<{
  part: StatusPart;
  timeZone: string;
  bookingGroupPart?: BookingGroupPartContext | null;
  pauseReason?: string;
}>) {
  const presentation = PUBLIC_STATUS_PRESENTATIONS[part.status];
  const StatusIcon = STATUS_ICONS[presentation.iconName];
  const partLabels =
    bookingGroupPart && isSplitBookingGroupPart(bookingGroupPart)
      ? formatBookingGroupPart(bookingGroupPart)
      : null;
  const gateLabel = part.gateLabel || "–";
  const windowLabel = statusWindow(part, timeZone);
  return (
    <article className="public-status-part" data-status={part.status}>
      {partLabels && bookingGroupPart ? (
        <header className="public-status-part-header">
          <strong>{partLabels.long}</strong>
          <span>
            <Users aria-hidden="true" />
            {bookingGroupPart.passengerCount} Person
            {bookingGroupPart.passengerCount === 1 ? "" : "en"}
          </span>
        </header>
      ) : null}
      <section className="public-status-current">
        <span className="public-status-eyebrow">Aktueller Status</span>
        <div className="public-status-action">
          <StatusIcon aria-hidden="true" />
          <strong>
            <AutoFitText>{presentation.label}</AutoFitText>
          </strong>
        </div>
        <p>{publicStatusMessage(part.status, part.message, pauseReason)}</p>
      </section>
      <dl className="public-status-details">
        <div>
          <dt>
            <MapPin aria-hidden="true" />
            <AutoFitText>Gate</AutoFitText>
          </dt>
          <dd>
            <AutoFitText>{gateLabel}</AutoFitText>
          </dd>
        </div>
        <div>
          <dt>
            <Clock3 aria-hidden="true" />
            <AutoFitText>Geschätztes Zeitfenster</AutoFitText>
          </dt>
          <dd>
            <AutoFitText>{windowLabel}</AutoFitText>
          </dd>
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
}: Readonly<{
  updatedAt: string;
  timeZone: string;
  push: ReturnType<typeof import("./use-public-push").usePublicPush>;
  pushDescription: string;
}>) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  return (
    <>
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
        {push.message ? <output className="public-push-message">{push.message}</output> : null}
        <button className="public-privacy-link" onClick={() => setPrivacyOpen(true)} type="button">
          Datenschutz
        </button>
      </footer>
      <ModalDialog
        closeLabel="Datenschutz schließen"
        description="Datensparsame öffentliche Statusanzeige"
        onClose={() => setPrivacyOpen(false)}
        open={privacyOpen}
        size="compact"
        title="Datenschutz"
      >
        <div className="public-privacy-copy">
          <p>
            Für den Abruf dieser Statusseite werden keine Namen, Telefonnummern oder sonstigen
            Kontaktdaten von Gästen erfasst oder gespeichert. Der Zugriff erfolgt ausschließlich
            über den zufälligen Ticket- oder Gruppencode.
          </p>
          <p>
            Nur wenn Sie Benachrichtigungen aktivieren, speichert das System die technisch
            erforderliche pseudonyme Browser-Push-Adresse, die Push-Schlüssel und den
            Einwilligungszeitpunkt. Diese Daten dienen ausschließlich den Statushinweisen und werden
            bei Deaktivierung oder nach Ablauf der Veranstaltungsfrist gelöscht.
          </p>
        </div>
      </ModalDialog>
    </>
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
  | "forecastState"
  | "forecastReason"
>;

export type GroupStatusPart = PublicGroupStatus["parts"][number];

import "./public-status-v18.css";
