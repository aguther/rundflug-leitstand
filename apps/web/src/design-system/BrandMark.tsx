import { Plane } from "lucide-react";
import { useState } from "react";
import { resolveActiveEvent } from "../event-context";

export function BrandMark({
  className = "",
  eventId: explicitEventId,
  alt = "Veranstaltungslogo",
}: {
  className?: string;
  eventId?: string;
  alt?: string;
}) {
  const [unavailableLogoUrl, setUnavailableLogoUrl] = useState<string | null>(null);
  const eventId =
    explicitEventId ?? resolveActiveEvent(window.location.search, window.localStorage);
  const logoUrl = eventId ? `/api/public/events/${encodeURIComponent(eventId)}/logo` : null;

  if (logoUrl && unavailableLogoUrl !== logoUrl) {
    return (
      <span className={`brand-mark event-logo ${className}`.trim()}>
        <img alt={alt} onError={() => setUnavailableLogoUrl(logoUrl)} src={logoUrl} />
      </span>
    );
  }

  return <Plane aria-hidden="true" className={`brand-mark plane-mark ${className}`.trim()} />;
}
