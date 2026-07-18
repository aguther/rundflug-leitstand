import { useState } from "react";
import { resolveActiveEvent } from "../event-context";

export function BrandMark({ className = "" }: { className?: string }) {
  const [logoUnavailable, setLogoUnavailable] = useState(false);
  const eventId = resolveActiveEvent(window.location.search, window.localStorage);
  const logoUrl = eventId ? `/api/public/events/${encodeURIComponent(eventId)}/logo` : null;

  if (logoUrl && !logoUnavailable) {
    return (
      <span className={`brand-mark event-logo ${className}`.trim()}>
        <img alt="Veranstaltungslogo" onError={() => setLogoUnavailable(true)} src={logoUrl} />
      </span>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className={`brand-mark plane-mark ${className}`.trim()}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M17.8 19 13 13.9V17l1.8 1.8-1.4 1.4L12 19.5l-1.4.7-1.4-1.4L11 17v-3.1L6.2 19H4l3.4-7L3 9.6V7.5l8 2V4.8a1 1 0 0 1 2 0v4.7l8-2v2.1L16.6 12l3.4 7h-2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}
