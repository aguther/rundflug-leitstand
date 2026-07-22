import type { FidsLayout, FidsPreferences, FidsTheme } from "@rundflug/contracts";
import { LogOut, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ModalDialog } from "../../design-system/components";

type EditableFidsPreferences = Pick<FidsPreferences, "visibleRows" | "layout" | "theme">;

function editablePreferences(preferences: FidsPreferences): EditableFidsPreferences {
  return {
    visibleRows: preferences.visibleRows,
    layout: preferences.layout,
    theme: preferences.theme,
  };
}

export function FidsSettingsDialog({
  open,
  preferences,
  accountCode,
  eventName,
  onClose,
  onLogout,
  onSave,
}: {
  open: boolean;
  preferences: FidsPreferences;
  accountCode: string;
  eventName: string;
  onClose: () => void;
  onLogout: () => Promise<void>;
  onSave: (next: EditableFidsPreferences) => Promise<void>;
}) {
  const [draft, setDraft] = useState<EditableFidsPreferences>(() =>
    editablePreferences(preferences),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { visibleRows, layout, theme } = preferences;

  useEffect(() => {
    if (!open) return;
    setDraft({ visibleRows, layout, theme });
  }, [open, layout, theme, visibleRows]);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const close = () => {
    if (!saving) onClose();
  };
  const changeRows = (delta: number) => {
    setDraft((current) => ({
      ...current,
      visibleRows: Math.min(20, Math.max(4, current.visibleRows + delta)),
    }));
  };
  const selectLayout = (layout: FidsLayout) => setDraft((current) => ({ ...current, layout }));
  const selectTheme = (theme: FidsTheme) => setDraft((current) => ({ ...current, theme }));
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Einstellungen konnten nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      closeLabel="Einstellungen schließen"
      description={`Für ${accountCode} · ${eventName}`}
      onClose={close}
      open={open}
      size="default"
      title="FIDS-Einstellungen"
    >
      <div className="fids-settings-form">
        <section className="fids-settings-row-count" aria-labelledby="fids-visible-rows-label">
          <strong id="fids-visible-rows-label">Angezeigte Zeilen</strong>
          <div className="fids-row-stepper">
            <button
              aria-label="Eine Zeile weniger"
              disabled={draft.visibleRows <= 4 || saving}
              onClick={() => changeRows(-1)}
              type="button"
            >
              <Minus aria-hidden="true" />
            </button>
            <output aria-live="polite">{draft.visibleRows}</output>
            <button
              aria-label="Eine Zeile mehr"
              disabled={draft.visibleRows >= 20 || saving}
              onClick={() => changeRows(1)}
              type="button"
            >
              <Plus aria-hidden="true" />
            </button>
            <small>4 bis 20 Gruppen</small>
          </div>
        </section>

        <fieldset className="fids-settings-fieldset">
          <legend>Layout</legend>
          <div className="fids-settings-options fids-settings-options--layout">
            <label>
              <input
                checked={draft.layout === "SINGLE"}
                disabled={saving}
                name="fids-layout"
                onChange={() => selectLayout("SINGLE")}
                type="radio"
              />
              <span>Eine Spalte</span>
            </label>
            <label>
              <input
                checked={draft.layout === "DOUBLE"}
                disabled={saving}
                name="fids-layout"
                onChange={() => selectLayout("DOUBLE")}
                type="radio"
              />
              <span>
                Zwei Spalten
                <small>ab 1280 px</small>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset className="fids-settings-fieldset">
          <legend>Darstellung</legend>
          <div className="fids-settings-options fids-settings-options--theme">
            {(["SYSTEM", "LIGHT", "DARK"] as const).map((theme) => (
              <label key={theme}>
                <input
                  checked={draft.theme === theme}
                  disabled={saving}
                  name="fids-theme"
                  onChange={() => selectTheme(theme)}
                  type="radio"
                />
                <span>{{ SYSTEM: "System", LIGHT: "Hell", DARK: "Dunkel" }[theme]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error ? (
          <p className="fids-settings-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="fids-settings-actions">
          <Button
            className="fids-logout-button"
            disabled={saving}
            onClick={() => void onLogout()}
            type="button"
            variant="ghost"
          >
            <LogOut aria-hidden="true" />
            Abmelden
          </Button>
          <div>
            <Button disabled={saving} onClick={close} type="button" variant="secondary">
              Abbrechen
            </Button>
            <Button disabled={saving} onClick={() => void save()} type="button" variant="primary">
              {saving ? "Speichert …" : "Speichern"}
            </Button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
