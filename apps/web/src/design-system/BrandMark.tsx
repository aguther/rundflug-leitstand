import type { EventLogoTheme } from "@rundflug/contracts";
import { useState } from "react";
import { resolveActiveEvent, useOptionalActiveEvent } from "../event-context";
import { useTheme } from "./theme";

export function BrandSymbol({
  className = "",
  labelled = false,
}: Readonly<{
  className?: string;
  labelled?: boolean;
}>) {
  return (
    <svg
      aria-hidden={labelled ? undefined : "true"}
      aria-label={labelled ? "Rundflug Leitstand" : undefined}
      className={className}
      fill="none"
      role={labelled ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 48 48"
    >
      <path className="brand-symbol-route" d="M32.54 4.82A21 21 0 1 0 43.18 15.46" />
      <g className="brand-symbol-aircraft" transform="translate(9.6 9.6) scale(1.2)">
        <path d="M3 22h18" />
        <path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z" />
      </g>
      <circle className="brand-symbol-node" cx="38.85" cy="9.15" r="2.24" />
    </svg>
  );
}

export function BrandLockup({ className = "" }: Readonly<{ className?: string }>) {
  return (
    <span aria-label="Rundflug Leitstand" className={`brand-lockup ${className}`.trim()} role="img">
      <BrandSymbol className="brand-lockup-symbol" />
      <span aria-hidden="true" className="brand-lockup-word">
        <span className="brand-lockup-primary">Rundflug</span>
        <span className="brand-lockup-secondary">Leitstand</span>
      </span>
    </span>
  );
}

export function BrandMark({
  className = "",
  eventId: explicitEventId,
  alt = "Veranstaltungslogo",
  theme: explicitTheme,
  revision,
}: Readonly<{
  className?: string;
  eventId?: string;
  alt?: string;
  theme?: EventLogoTheme;
  revision?: number | string;
}>) {
  const { resolved } = useTheme();
  const activeEvent = useOptionalActiveEvent();
  const [unavailableLogoUrl, setUnavailableLogoUrl] = useState<string | null>(null);
  const eventId =
    explicitEventId ??
    activeEvent?.eventId ??
    resolveActiveEvent(window.location.search, window.localStorage);
  const theme = explicitTheme ?? resolved;
  const revisionQuery = revision === undefined ? "" : `&v=${encodeURIComponent(revision)}`;
  const logoUrl = eventId
    ? `/api/public/events/${encodeURIComponent(eventId)}/logo?theme=${theme}${revisionQuery}`
    : null;

  if (logoUrl && unavailableLogoUrl !== logoUrl) {
    return (
      <span className={`brand-mark event-logo ${className}`.trim()}>
        <img alt={alt} onError={() => setUnavailableLogoUrl(logoUrl)} src={logoUrl} />
      </span>
    );
  }

  return <BrandSymbol className={`brand-mark fallback-mark ${className}`.trim()} />;
}
