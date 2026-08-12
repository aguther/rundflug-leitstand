import type { EventLogoTheme } from "@rundflug/contracts";
import { ImageUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "../../../design-system/BrandMark";
import { Button, ConfirmationDialog } from "../../../design-system/components";

const THEME_LABELS: Record<EventLogoTheme, string> = {
  light: "helles Theme",
  dark: "dunkles Theme",
};
const ACCEPTED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const MAX_LOGO_BYTES = 1_048_576;

export function EventAppearancePanel({
  eventId,
  eventVersion,
  logoVariants,
  administrator,
  busyActionKey,
  onUpload,
  onRemove,
}: Readonly<{
  eventId: string;
  eventVersion: number;
  logoVariants: Record<EventLogoTheme, boolean>;
  administrator: boolean;
  busyActionKey: string | null;
  onUpload: (theme: EventLogoTheme, file: File) => void;
  onRemove: (theme: EventLogoTheme) => void;
}>) {
  const [errors, setErrors] = useState<Partial<Record<EventLogoTheme, string>>>({});
  const [removeTheme, setRemoveTheme] = useState<EventLogoTheme | null>(null);

  function selectLogo(theme: EventLogoTheme, file: File | null) {
    if (!file) return;
    if (!ACCEPTED_LOGO_TYPES.has(file.type)) {
      setErrors((current) => ({
        ...current,
        [theme]: "Bitte PNG, JPEG, WebP oder ein sicheres SVG auswählen.",
      }));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setErrors((current) => ({
        ...current,
        [theme]: "Die Logodatei darf höchstens 1 MiB groß sein.",
      }));
      return;
    }
    setErrors((current) => ({ ...current, [theme]: undefined }));
    onUpload(theme, file);
  }

  return (
    <>
      <section aria-labelledby="event-appearance-title" className="event-appearance-panel">
        <div className="event-parameter-section-heading">
          <div>
            <h3 id="event-appearance-title">Veranstaltungslogos</h3>
            <p>Getrennte Varianten für helle und dunkle Anzeigen, jeweils bis 1 MiB.</p>
          </div>
        </div>
        <div className="event-appearance-grid">
          {(["light", "dark"] as const).map((theme) => {
            const label = THEME_LABELS[theme];
            const hasVariant = logoVariants[theme];
            const error = errors[theme];
            return (
              <article className={`event-appearance-card is-${theme}`} key={theme}>
                <div className="event-appearance-preview">
                  <BrandMark
                    alt={`Logo-Vorschau für ${label}`}
                    eventId={eventId}
                    revision={eventVersion}
                    theme={theme}
                  />
                </div>
                <div className="event-appearance-copy">
                  <strong>Logo für {label}</strong>
                  <span>
                    {hasVariant ? "Eigene Variante hinterlegt" : "Fallback-Logo wird verwendet"}
                  </span>
                </div>
                <div className="event-appearance-actions">
                  <label
                    className={`ds-button ds-button--secondary ds-button--compact${
                      !administrator ? " is-disabled" : ""
                    }`}
                  >
                    <ImageUp aria-hidden="true" />
                    Logo auswählen
                    <input
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      aria-label={`Logo für ${label} auswählen`}
                      disabled={!administrator || busyActionKey !== null}
                      key={`${theme}-${eventVersion}`}
                      onChange={(inputEvent) => {
                        selectLogo(theme, inputEvent.target.files?.[0] ?? null);
                        inputEvent.target.value = "";
                      }}
                      type="file"
                    />
                  </label>
                  <Button
                    busy={busyActionKey === `clear-event-logo-${theme}`}
                    disabled={!administrator || !hasVariant}
                    onClick={() => setRemoveTheme(theme)}
                    size="compact"
                    variant="danger"
                  >
                    <Trash2 aria-hidden="true" />
                    Entfernen
                  </Button>
                </div>
                {error ? (
                  <p className="event-appearance-error" role="alert">
                    {error}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
      <ConfirmationDialog
        body={
          <p>
            Die eigene Logo-Variante wird entfernt. Anschließend wird wieder das Fallback-Logo
            verwendet.
          </p>
        }
        confirmLabel="Logo entfernen"
        danger
        onCancel={() => setRemoveTheme(null)}
        onConfirm={() => {
          if (removeTheme) onRemove(removeTheme);
          setRemoveTheme(null);
        }}
        open={removeTheme !== null}
        title="Logo-Variante entfernen?"
      />
    </>
  );
}
