import { Plane } from "lucide-react";
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

  return <Plane aria-hidden="true" className={`brand-mark plane-mark ${className}`.trim()} />;
}
