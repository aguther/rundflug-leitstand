import type { EventLogoTheme } from "@rundflug/contracts";
import { Trash2, Upload } from "lucide-react";
import { BrandMark } from "../../design-system/BrandMark";
import { Button, Field } from "../../design-system/components";

const THEME_LABELS: Record<EventLogoTheme, string> = {
  light: "helles Theme",
  dark: "dunkles Theme",
};

export function EventLogoEditor({
  eventId,
  eventVersion,
  files,
  logoVariants,
  administrator,
  busyActionKey,
  onFileChange,
  onUpload,
  onRemove,
}: {
  eventId: string;
  eventVersion: number;
  files: Record<EventLogoTheme, File | null>;
  logoVariants: Record<EventLogoTheme, boolean>;
  administrator: boolean;
  busyActionKey: string | null;
  onFileChange: (theme: EventLogoTheme, file: File | null) => void;
  onUpload: (theme: EventLogoTheme) => void;
  onRemove: (theme: EventLogoTheme) => void;
}) {
  return (
    <section aria-labelledby="event-logo-editor-title" className="event-logo-editor-v15">
      <div className="event-logo-editor-heading">
        <strong id="event-logo-editor-title">Veranstaltungslogos</strong>
        <span>PNG, JPEG, WebP oder sicheres SVG bis 1 MiB.</span>
      </div>
      <div className="event-logo-variant-grid">
        {(["light", "dark"] as const).map((theme) => {
          const themeLabel = THEME_LABELS[theme];
          const hasOwnVariant = logoVariants[theme];
          const uploadKey = `event-logo-${theme}`;
          const removeKey = `clear-event-logo-${theme}`;
          return (
            <article className={`event-logo-variant event-logo-variant--${theme}`} key={theme}>
              <div className="event-logo-preview">
                <BrandMark
                  alt={`Logo-Vorschau für ${themeLabel}`}
                  eventId={eventId}
                  revision={eventVersion}
                  theme={theme}
                />
              </div>
              <div className="event-logo-variant-copy">
                <strong>Logo für {themeLabel}</strong>
                <span>
                  {hasOwnVariant
                    ? "Eigene Variante hinterlegt"
                    : "Keine eigene Variante · Vorschau verwendet den Fallback"}
                </span>
              </div>
              <Field label={`Datei für ${themeLabel}`}>
                <input
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  key={`${theme}-${eventVersion}`}
                  onChange={(event) => onFileChange(theme, event.target.files?.[0] ?? null)}
                  type="file"
                />
              </Field>
              <div className="event-logo-variant-actions">
                <Button
                  busy={busyActionKey === uploadKey}
                  disabled={!files[theme] || !administrator}
                  onClick={() => onUpload(theme)}
                  size="compact"
                >
                  <Upload aria-hidden="true" /> Hochladen
                </Button>
                <Button
                  busy={busyActionKey === removeKey}
                  disabled={!administrator || !hasOwnVariant}
                  onClick={() => onRemove(theme)}
                  size="compact"
                  variant="danger"
                >
                  <Trash2 aria-hidden="true" /> Entfernen
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
