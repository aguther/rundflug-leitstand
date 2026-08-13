import type {
  FidsFilterOptions,
  FidsLayout,
  FidsPreferences,
  FidsTheme,
  FidsViewMode,
} from "@rundflug/contracts";
import { LogOut, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, ModalDialog } from "../../design-system/components";
import type { EditableFidsPreferences } from "./fids-data-source";

function editablePreferences(preferences: FidsPreferences): EditableFidsPreferences {
  const { version: _version, ...editable } = preferences;
  return editable;
}

function toggleFilterId(allIds: string[], selectedIds: string[], id: string): string[] {
  if (selectedIds.length === 0) return allIds.filter((candidate) => candidate !== id);
  const next = selectedIds.includes(id)
    ? selectedIds.filter((candidate) => candidate !== id)
    : [...selectedIds, id];
  return next.length === allIds.length ? [] : next;
}

function Stepper({
  label,
  value,
  minimum,
  maximum,
  disabled,
  onChange,
}: Readonly<{
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  disabled: boolean;
  onChange: (value: number) => void;
}>) {
  return (
    <div className="fids-setting-line">
      <strong>{label}</strong>
      <div className="fids-row-stepper">
        <button
          aria-label={`${label} verringern`}
          disabled={disabled || value <= minimum}
          onClick={() => onChange(value - 1)}
          type="button"
        >
          <Minus aria-hidden="true" />
        </button>
        <output aria-live="polite">{value}</output>
        <button
          aria-label={`${label} erhöhen`}
          disabled={disabled || value >= maximum}
          onClick={() => onChange(value + 1)}
          type="button"
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function FidsSettingsDialog({
  open,
  preferences,
  filterOptions,
  filterOptionsLoaded,
  departedVisibilitySeconds,
  accountCode,
  eventName,
  page,
  setupMode,
  onClose,
  onLogout,
  onSave,
  onSetSetupMode,
}: Readonly<{
  open: boolean;
  preferences: FidsPreferences;
  filterOptions: FidsFilterOptions;
  filterOptionsLoaded: boolean;
  departedVisibilitySeconds: number;
  accountCode: string;
  eventName: string;
  page: number;
  setupMode: boolean;
  onClose: () => void;
  onLogout?: () => Promise<void>;
  onSave: (next: EditableFidsPreferences) => Promise<void>;
  onSetSetupMode: (active: boolean) => void;
}>) {
  const [draft, setDraft] = useState<EditableFidsPreferences>(() =>
    editablePreferences(preferences),
  );
  const [saving, setSaving] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(editablePreferences(preferences));
    setError(null);
  }, [open, preferences]);

  const unavailableIds = useMemo(() => {
    if (!filterOptionsLoaded) return [];
    const products = new Set(filterOptions.products.map((option) => option.id));
    const gates = new Set(filterOptions.gates.map((option) => option.id));
    return [
      ...draft.contentFilter.productIds.filter((id) => !products.has(id)),
      ...draft.contentFilter.gateIds.filter((id) => !gates.has(id)),
    ];
  }, [draft.contentFilter, filterOptions, filterOptionsLoaded]);

  const close = () => {
    if (!saving) onClose();
  };
  const selectLayout = (layout: FidsLayout) => setDraft((current) => ({ ...current, layout }));
  const selectTheme = (theme: FidsTheme) => setDraft((current) => ({ ...current, theme }));
  const selectViewMode = (viewMode: FidsViewMode) =>
    setDraft((current) => ({ ...current, viewMode }));
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
  const logout = async () => {
    if (!onLogout) return;
    setLogoutBusy(true);
    try {
      await onLogout();
    } finally {
      setLogoutBusy(false);
    }
  };

  return (
    <ModalDialog
      closeLabel="Einstellungen schließen"
      description={`Für ${accountCode} · ${eventName}`}
      onClose={close}
      open={open}
      size="wide"
      title="FIDS-Einstellungen"
    >
      <div className="fids-settings-form">
        <div className="fids-settings-scroll">
          <section className="fids-settings-section">
            <h3>Ansicht</h3>
            <div className="fids-settings-options fids-settings-options--layout">
              {(["FIXED_PAGE", "SPLIT"] as const).map((viewMode) => (
                <label key={viewMode}>
                  <input
                    checked={draft.viewMode === viewMode}
                    disabled={saving}
                    name="fids-view-mode"
                    onChange={() => selectViewMode(viewMode)}
                    type="radio"
                  />
                  <span>
                    {viewMode === "FIXED_PAGE" ? "Feste Seite" : "Geteilte Ansicht"}
                    <small>
                      {viewMode === "FIXED_PAGE"
                        ? `URL-Seite ${page} bleibt stehen`
                        : "Nur der untere Bereich wechselt"}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <Stepper
              disabled={saving}
              label="Anzeigeplätze gesamt"
              maximum={20}
              minimum={4}
              onChange={(visibleRows) =>
                setDraft((current) => ({
                  ...current,
                  visibleRows,
                  priorityGroupCount: Math.min(current.priorityGroupCount, visibleRows - 1),
                }))
              }
              value={draft.visibleRows}
            />
            <label className="fids-shared-flight-setting">
              <input
                aria-label="Gruppen desselben Flugs zusammenfassen"
                checked={draft.groupSharedFlights}
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    groupSharedFlights: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>
                <strong>Gruppen desselben Flugs zusammenfassen</strong>
                <small>
                  Zeigt bis zu drei Buchungsgruppen gemeinsam, wenn Produkt, Gate, Status und der
                  nächste operative Flug übereinstimmen. Aktive Nachrufe bleiben einzeln.
                </small>
              </span>
            </label>
            {draft.viewMode === "SPLIT" ? (
              <div className="fids-split-settings">
                <Stepper
                  disabled={saving}
                  label="Oben reservierte Plätze"
                  maximum={draft.visibleRows - 1}
                  minimum={1}
                  onChange={(priorityGroupCount) =>
                    setDraft((current) => ({ ...current, priorityGroupCount }))
                  }
                  value={draft.priorityGroupCount}
                />
                <Stepper
                  disabled={saving}
                  label="Seitenwechsel unten"
                  maximum={60}
                  minimum={5}
                  onChange={(rotationIntervalSeconds) =>
                    setDraft((current) => ({ ...current, rotationIntervalSeconds }))
                  }
                  value={draft.rotationIntervalSeconds}
                />
                <div className="fids-split-guidance">
                  <strong>
                    Oben: {draft.priorityGroupCount} reservierte Plätze · unten:{" "}
                    {draft.visibleRows - draft.priorityGroupCount} Plätze je Seite
                  </strong>
                  <p>
                    BOARDING und BITTE ZUM GATE stehen zuerst oben. Kürzlich abgeflogene Gruppen
                    folgen für die veranstaltungsweit konfigurierte Dauer. BEREITHALTEN füllt danach
                    freie reservierte Plätze. Handlungsrelevante und kürzlich abgeflogene Gruppen
                    können den oberen Bereich vorübergehend erweitern; nur die übrigen Gruppen
                    rotieren unten.
                  </p>
                  <p>
                    Abgeflogene Gruppen bleiben {departedVisibilitySeconds} Sek. oben sichtbar.
                    <br />
                    Änderbar unter Administration → Veranstaltungsparameter.
                  </p>
                </div>
              </div>
            ) : null}
          </section>

          <section className="fids-settings-section fids-settings-grid">
            <div>
              <h3>Layout</h3>
              <div className="fids-settings-options">
                {(["SINGLE", "DOUBLE"] as const).map((layout) => (
                  <label key={layout}>
                    <input
                      checked={draft.layout === layout}
                      disabled={saving}
                      name="fids-layout"
                      onChange={() => selectLayout(layout)}
                      type="radio"
                    />
                    <span>{layout === "SINGLE" ? "Eine Spalte" : "Zwei Spalten"}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3>Darstellung</h3>
              <div className="fids-settings-options">
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
            </div>
          </section>

          <section className="fids-settings-section fids-settings-grid">
            {[
              {
                title: "Produkte",
                options: filterOptions.products.map((option) => ({
                  id: option.id,
                  label: `${option.code} · ${option.name}`,
                  active: option.active,
                })),
                selected: draft.contentFilter.productIds,
                key: "productIds" as const,
              },
              {
                title: "Gates",
                options: filterOptions.gates,
                selected: draft.contentFilter.gateIds,
                key: "gateIds" as const,
              },
            ].map((dimension) => {
              const allIds = dimension.options.map((option) => option.id);
              return (
                <fieldset className="fids-filter-list" key={dimension.key}>
                  <legend>{dimension.title}</legend>
                  <label>
                    <input
                      checked={dimension.selected.length === 0}
                      disabled={saving}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          contentFilter: { ...current.contentFilter, [dimension.key]: [] },
                        }))
                      }
                      type="checkbox"
                    />
                    <span>Alle</span>
                  </label>
                  {dimension.options.map((option) => (
                    <label key={option.id}>
                      <input
                        checked={
                          dimension.selected.length === 0 || dimension.selected.includes(option.id)
                        }
                        disabled={saving}
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            contentFilter: {
                              ...current.contentFilter,
                              [dimension.key]: toggleFilterId(
                                allIds,
                                current.contentFilter[dimension.key],
                                option.id,
                              ),
                            },
                          }))
                        }
                        type="checkbox"
                      />
                      <span>
                        {option.label}
                        {option.active ? "" : " · inaktiv"}
                      </span>
                    </label>
                  ))}
                  {dimension.options.length === 0 ? (
                    <small>
                      {filterOptionsLoaded
                        ? "Keine Optionen vorhanden."
                        : "Optionen werden geladen …"}
                    </small>
                  ) : null}
                </fieldset>
              );
            })}
          </section>

          <section className="fids-settings-section fids-setup-setting">
            <div>
              <h3>Display-Setup</h3>
              <p>Seite {page} ist URL-Zustand und wird nicht im Konto gespeichert.</p>
            </div>
            <Button
              disabled={saving}
              onClick={() => {
                onSetSetupMode(!setupMode);
                onClose();
              }}
              type="button"
              variant="secondary"
            >
              {setupMode ? "Setup beenden" : "Setup aktivieren"}
            </Button>
          </section>

          {unavailableIds.length > 0 ? (
            <output className="fids-settings-warning">
              {unavailableIds.length} nicht mehr verfügbare Auswahl(en) werden beim Speichern
              entfernt.
            </output>
          ) : null}
          {error ? (
            <p className="fids-settings-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="fids-settings-actions">
          {onLogout ? (
            <Button
              className="fids-logout-button"
              disabled={saving || logoutBusy}
              busy={logoutBusy}
              onClick={() => void logout()}
              type="button"
              variant="ghost"
            >
              <LogOut aria-hidden="true" /> Abmelden
            </Button>
          ) : (
            <span />
          )}
          <div>
            <Button disabled={saving} onClick={close} type="button" variant="secondary">
              Abbrechen
            </Button>
            <Button
              busy={saving}
              disabled={
                logoutBusy || !filterOptionsLoaded || draft.priorityGroupCount >= draft.visibleRows
              }
              onClick={() => void save()}
              type="button"
              variant="primary"
            >
              Speichern
            </Button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
