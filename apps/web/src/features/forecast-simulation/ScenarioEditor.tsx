import {
  DEFAULT_FORECAST_TUNING_PROFILE,
  DEFAULT_PRECALL_TUNING_PROFILE,
  type ForecastTuningProfile,
  type PrecallTuningProfile,
} from "@rundflug/domain";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button, SidePanel } from "../../design-system/components";
import type { SimulationConfig, TriangularDistribution } from "./model";

interface ScenarioEditorProps {
  open: boolean;
  config: SimulationConfig;
  errors: readonly string[];
  onChange: (config: SimulationConfig) => void;
  onApply: () => void;
  onClose: () => void;
}

type EditorTab = "ADMIN" | "REALITY" | "TUNING";
type DistributionKey = keyof SimulationConfig["realityModel"]["phases"];
type DistributionValue = keyof TriangularDistribution;

const PHASE_LABELS: Record<DistributionKey, string> = {
  boarding: "Boarding",
  flight: "Flug",
  deboarding: "Deboarding",
  buffer: "Puffer",
};

interface TuningField<Key extends string> {
  key: Key;
  label: string;
  help: string;
  min: number;
  max: number;
  step?: number;
}

const FORECAST_FIELDS: readonly TuningField<keyof ForecastTuningProfile>[] = [
  {
    key: "maximumSamples",
    label: "Maximale Lernwerte",
    help: "Begrenzt die jüngsten robusten Umläufe je Produkt und Flugzeugtyp.",
    min: 1,
    max: 100,
  },
  {
    key: "referenceWeight",
    label: "Gewicht Referenzdauer",
    help: "Einfluss des Admin-Planwerts gegenüber bestätigten Tageswerten.",
    min: 0.1,
    max: 20,
    step: 0.1,
  },
  {
    key: "firstSampleWeight",
    label: "Gewicht erster Messwert",
    help: "Ausgangsgewicht des ältesten berücksichtigten Ist-Umlaufs.",
    min: 0.1,
    max: 20,
    step: 0.1,
  },
  {
    key: "recencyWeightIncrement",
    label: "Zuwachs je neuerem Wert",
    help: "Zusätzliches Gewicht je zeitlich neuerem Ist-Umlauf.",
    min: 0,
    max: 10,
    step: 0.1,
  },
  {
    key: "referenceOutlierMultiplier",
    label: "Ausreißergrenze × Referenz",
    help: "Längere Messwerte werden vor der MAD-Prüfung verworfen.",
    min: 1,
    max: 10,
    step: 0.05,
  },
  {
    key: "madMultiplier",
    label: "MAD-Faktor",
    help: "Robuste statistische Toleranz um den Median.",
    min: 0,
    max: 20,
    step: 0.1,
  },
  {
    key: "minimumMadToleranceRatio",
    label: "Mindesttoleranz zur Referenz",
    help: "Untergrenze der MAD-Toleranz als Anteil der Referenzdauer.",
    min: 0,
    max: 5,
    step: 0.05,
  },
  {
    key: "stableMinimumSamples",
    label: "Mindestwerte für STABLE",
    help: "Weniger robuste Werte bleiben in der Qualität CHANGING.",
    min: 1,
    max: 100,
  },
  {
    key: "stableMaximumMeanDeviationMinutes",
    label: "Max. Abweichung für STABLE",
    help: "Höchste mittlere absolute Abweichung für stabile Qualität.",
    min: 0,
    max: 120,
    step: 0.5,
  },
  {
    key: "stableMarginMinutes",
    label: "Marge bei STABLE",
    help: "Interne Dauerreserve ober- und unterhalb der Erwartung.",
    min: 0,
    max: 120,
    step: 0.5,
  },
  {
    key: "changingMarginMinutes",
    label: "Marge bei CHANGING",
    help: "Breitere Dauerreserve für Kaltstart und schwankende Daten.",
    min: 0,
    max: 240,
    step: 0.5,
  },
];

const PRECALL_FIELDS: readonly TuningField<keyof PrecallTuningProfile>[] = [
  {
    key: "desiredGateWaitMinutes",
    label: "Gewünschte Gate-Wartezeit",
    help: "Weiches Ziel der adaptiven Nachregelung.",
    min: 0,
    max: 120,
  },
  {
    key: "baselineLeadMinutes",
    label: "Kaltstart-Vorlauf",
    help: "Vorlauf ohne bestätigte Gate-Wartezeiten.",
    min: 0,
    max: 240,
  },
  {
    key: "minimumLeadMinutes",
    label: "Minimaler Vorlauf",
    help: "Untere Grenze des adaptiven Voraufrufs.",
    min: 0,
    max: 240,
  },
  {
    key: "maximumLeadMinutes",
    label: "Maximaler Vorlauf",
    help: "Obere Grenze des adaptiven Voraufrufs.",
    min: 0,
    max: 240,
  },
  {
    key: "correctionFactor",
    label: "Korrekturfaktor",
    help: "Stärke der Anpassung an beobachtete Gate-Wartezeiten.",
    min: 0,
    max: 5,
    step: 0.05,
  },
  {
    key: "observationSampleLimit",
    label: "Beobachtete Voraufrufe",
    help: "Zahl der jüngsten Gate-Wartezeiten für die Nachregelung.",
    min: 1,
    max: 100,
  },
  {
    key: "gateCooldownMinutes",
    label: "Gate-Sperrzeit",
    help: "Mindestabstand zwischen zwei automatischen Voraufrufen.",
    min: 0,
    max: 60,
  },
];

function NumberInput({
  label,
  value,
  min = 0,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      aria-label={label}
      className="sim-number-field"
      max={max}
      min={min}
      onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      step={step}
      type="number"
      value={value}
    />
  );
}

function ParameterTag({ kind }: { kind: "Admin" | "Simulation" | "Experiment" }) {
  return (
    <span className={`sim-parameter-tag sim-parameter-tag--${kind.toLowerCase()}`}>{kind}</span>
  );
}

function DistributionInputs({
  id,
  value,
  onChange,
}: {
  id: string;
  value: TriangularDistribution;
  onChange: (value: TriangularDistribution) => void;
}) {
  const update = (key: DistributionValue, next: number) => onChange({ ...value, [key]: next });
  return (
    <div className="sim-distribution-inputs">
      <NumberInput
        label={`${id}, Minimum`}
        onChange={(next) => update("minimum", next)}
        value={value.minimum}
      />
      <span aria-hidden="true">/</span>
      <NumberInput
        label={`${id}, typisch`}
        onChange={(next) => update("typical", next)}
        value={value.typical}
      />
      <span aria-hidden="true">/</span>
      <NumberInput
        label={`${id}, Maximum`}
        onChange={(next) => update("maximum", next)}
        value={value.maximum}
      />
      <small>Min.</small>
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="sim-toggle">
      <input
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span aria-hidden="true" />
      <b className="visually-hidden">{label}</b>
    </label>
  );
}

export function ScenarioEditor({
  open,
  config,
  errors,
  onChange,
  onApply,
  onClose,
}: ScenarioEditorProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>("ADMIN");
  const updateAdmin = (next: Partial<SimulationConfig["adminParameters"]>) =>
    onChange({ ...config, adminParameters: { ...config.adminParameters, ...next } });
  const updateReality = (next: Partial<SimulationConfig["realityModel"]>) =>
    onChange({ ...config, realityModel: { ...config.realityModel, ...next } });
  const updatePhase = (phase: DistributionKey, value: TriangularDistribution) => {
    updateReality({ phases: { ...config.realityModel.phases, [phase]: value } });
  };
  const updateIncident = <Key extends keyof SimulationConfig["realityModel"]["incidents"]>(
    key: Key,
    value: SimulationConfig["realityModel"]["incidents"][Key],
  ) =>
    updateReality({
      incidents: { ...config.realityModel.incidents, [key]: value },
    });
  const updateForecast = (key: keyof ForecastTuningProfile, value: number) =>
    onChange({
      ...config,
      forecastTuning: {
        ...config.forecastTuning,
        forecast: { ...config.forecastTuning.forecast, [key]: value },
      },
    });
  const updatePrecall = (key: keyof PrecallTuningProfile, value: number) =>
    onChange({
      ...config,
      forecastTuning: {
        ...config.forecastTuning,
        precall: { ...config.forecastTuning.precall, [key]: value },
      },
    });

  return (
    <SidePanel
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button disabled={errors.length > 0} onClick={onApply} variant="primary">
            Übernehmen &amp; neu starten
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title={
        <span className="sim-editor-title">
          Szenario konfigurieren
          <small>Planwerte, simulierte Realität und lokales Prognose-Labor</small>
        </span>
      }
    >
      <nav aria-label="Konfigurationsbereiche" className="sim-editor-tabs">
        {[
          ["ADMIN", "Betrieb"],
          ["REALITY", "Simulierte Realität"],
          ["TUNING", "Prognose-Labor"],
        ].map(([id, label]) => (
          <button
            aria-current={activeTab === id ? "page" : undefined}
            key={id}
            onClick={() => setActiveTab(id as EditorTab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "ADMIN" ? (
        <div className="sim-editor-tab-content">
          <section className="sim-editor-card">
            <header className="sim-editor-section-heading">
              <div>
                <h3>Fachliche Planwerte</h3>
                <p>Diese Werte entsprechen den wirksamen Parametern der Admin-Oberfläche.</p>
              </div>
              <ParameterTag kind="Admin" />
            </header>
            <div className="sim-admin-grid">
              {(
                [
                  { label: "Plan Boarding", key: "plannedBoardingMinutes", minimum: 1 },
                  {
                    label: "Produkt-Referenzdauer",
                    key: "productReferenceDurationMinutes",
                    minimum: 1,
                  },
                  { label: "Plan Ausstieg", key: "plannedDeboardingMinutes", minimum: 1 },
                  { label: "Plan Puffer", key: "plannedBufferMinutes", minimum: 0 },
                ] as const
              ).map(({ label, key, minimum }) => (
                <div className="sim-form-field" key={key}>
                  <span>{label}</span>
                  <div className="sim-input-unit">
                    <NumberInput
                      label={`${label} in Minuten`}
                      min={minimum}
                      max={600}
                      onChange={(value) => updateAdmin({ [key]: value })}
                      value={config.adminParameters[key]}
                    />
                    <small>Min.</small>
                  </div>
                </div>
              ))}
            </div>
            <p className="sim-editor-hint">
              Die Referenzdauer startet die Prognose kalt. Die tatsächlichen Zeiten werden getrennt
              im Register „Simulierte Realität“ erzeugt.
            </p>
          </section>

          <section className="sim-editor-card">
            <header className="sim-editor-section-heading">
              <div>
                <h3>Flotte und aktive Kapazität</h3>
                <p>
                  Produktiv begrenzen verfügbare Flugzeuge und aktive Piloten gemeinsam die Queue.
                </p>
              </div>
              <ParameterTag kind="Admin" />
            </header>
            <div className="sim-admin-grid">
              <div className="sim-form-field">
                <span>Flugzeuge</span>
                <NumberInput
                  label="Anzahl Flugzeuge"
                  min={1}
                  max={12}
                  onChange={(aircraftCount) => updateAdmin({ aircraftCount })}
                  value={config.adminParameters.aircraftCount}
                />
              </div>
              <label className="sim-form-field">
                <span>Flugzeugtyp</span>
                <input
                  aria-label="Flugzeugtyp"
                  onChange={(event) => updateAdmin({ aircraftType: event.currentTarget.value })}
                  type="text"
                  value={config.adminParameters.aircraftType}
                />
              </label>
              <div className="sim-form-field">
                <span>Passagierplätze je Flugzeug</span>
                <NumberInput
                  label="Passagierplätze je Flugzeug"
                  min={1}
                  max={100}
                  onChange={(passengerSeats) => updateAdmin({ passengerSeats })}
                  value={config.adminParameters.passengerSeats}
                />
              </div>
              <div className="sim-form-field">
                <span>Aktive Pilotenkapazität</span>
                <NumberInput
                  label="Aktive Pilotenkapazität"
                  max={100}
                  onChange={(activePilotCount) => updateAdmin({ activePilotCount })}
                  value={config.adminParameters.activePilotCount}
                />
              </div>
            </div>
          </section>

          <section className="sim-editor-card">
            <header className="sim-editor-section-heading">
              <div>
                <h3>Automatischer Voraufruf</h3>
                <p>
                  Beide Aktivierungen müssen gelten. `GO TO GATE` bindet weiterhin kein Flugzeug.
                </p>
              </div>
              <ParameterTag kind="Admin" />
            </header>
            <div className="sim-toggle-list">
              <div>
                <span>Für Veranstaltung aktiviert</span>
                <Toggle
                  checked={config.adminParameters.eventAutomaticPrecallEnabled}
                  label="Automatischen Voraufruf für Veranstaltung aktivieren"
                  onChange={(eventAutomaticPrecallEnabled) =>
                    updateAdmin({ eventAutomaticPrecallEnabled })
                  }
                />
              </div>
              <div>
                <span>Für Ressourcengruppe aktiviert</span>
                <Toggle
                  checked={config.adminParameters.resourceGroupAutomaticPrecallEnabled}
                  label="Automatischen Voraufruf für Ressourcengruppe aktivieren"
                  onChange={(resourceGroupAutomaticPrecallEnabled) =>
                    updateAdmin({ resourceGroupAutomaticPrecallEnabled })
                  }
                />
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "REALITY" ? (
        <div className="sim-editor-tab-content">
          <section className="sim-editor-card">
            <header className="sim-editor-section-heading">
              <div>
                <h3>Nachfrage und Realzeiten</h3>
                <p>Diese Werte erzeugen die synthetische Realität, nicht die Prognosegrundlage.</p>
              </div>
              <ParameterTag kind="Simulation" />
            </header>
            <div className="sim-demand-editor">
              <span>Nachfrage</span>
              <div className="sim-input-unit">
                <NumberInput
                  label="Nachfrage in Personen je Stunde"
                  onChange={(demandPersonsPerHour) => updateReality({ demandPersonsPerHour })}
                  value={config.realityModel.demandPersonsPerHour}
                />
                <small>Pers./Std.</small>
              </div>
            </div>
            <div className="sim-editor-table sim-editor-table--phases">
              <div className="sim-editor-table-head">
                <span>Phase</span>
                <span>Minimum / typisch / Maximum</span>
              </div>
              {(Object.keys(PHASE_LABELS) as DistributionKey[]).map((phase) => (
                <div className="sim-editor-row" key={phase}>
                  <span className="sim-editor-row-label">{PHASE_LABELS[phase]}</span>
                  <DistributionInputs
                    id={PHASE_LABELS[phase]}
                    onChange={(value) => updatePhase(phase, value)}
                    value={config.realityModel.phases[phase]}
                  />
                </div>
              ))}
            </div>
            <p className="sim-editor-hint">Es gilt Minimum ≤ typisch ≤ Maximum.</p>
          </section>

          <section className="sim-editor-card">
            <header className="sim-editor-section-heading">
              <div>
                <h3>Betriebsereignisse</h3>
                <p>Auslöser und Dauer wirken ausschließlich auf den synthetischen Tagesablauf.</p>
              </div>
              <ParameterTag kind="Simulation" />
            </header>
            <div className="sim-incident-head">
              <span>Ereignis</span>
              <span>Aktiv</span>
              <span>Auslöser und Dauer (Minimum / typisch / Maximum)</span>
            </div>
            <div className="sim-incident-row">
              <span className="sim-incident-row-label">Tanken</span>
              <Toggle
                checked={config.realityModel.incidents.refueling.enabled}
                label="Tanken aktiv"
                onChange={(enabled) =>
                  updateIncident("refueling", {
                    ...config.realityModel.incidents.refueling,
                    enabled,
                  })
                }
              />
              <div className="sim-incident-values">
                <div className="sim-trigger-field">
                  alle
                  <NumberInput
                    label="Tankintervall in Umläufen"
                    min={1}
                    onChange={(everyRotations) =>
                      updateIncident("refueling", {
                        ...config.realityModel.incidents.refueling,
                        everyRotations,
                      })
                    }
                    value={config.realityModel.incidents.refueling.everyRotations}
                  />
                  Umläufe
                </div>
                <DistributionInputs
                  id="Tankdauer"
                  onChange={(duration) =>
                    updateIncident("refueling", {
                      ...config.realityModel.incidents.refueling,
                      duration,
                    })
                  }
                  value={config.realityModel.incidents.refueling.duration}
                />
              </div>
            </div>
            <div className="sim-incident-row">
              <span className="sim-incident-row-label">Geplante Pause</span>
              <Toggle
                checked={config.realityModel.incidents.plannedPause.enabled}
                label="Geplante Pause aktiv"
                onChange={(enabled) =>
                  updateIncident("plannedPause", {
                    ...config.realityModel.incidents.plannedPause,
                    enabled,
                  })
                }
              />
              <div className="sim-incident-values">
                <div className="sim-trigger-field">
                  alle
                  <NumberInput
                    label="Pausenintervall in Betriebsminuten"
                    min={1}
                    onChange={(everyOperatingMinutes) =>
                      updateIncident("plannedPause", {
                        ...config.realityModel.incidents.plannedPause,
                        everyOperatingMinutes,
                      })
                    }
                    value={config.realityModel.incidents.plannedPause.everyOperatingMinutes}
                  />
                  Betriebsmin.
                </div>
                <DistributionInputs
                  id="Geplante Pausendauer"
                  onChange={(duration) =>
                    updateIncident("plannedPause", {
                      ...config.realityModel.incidents.plannedPause,
                      duration,
                    })
                  }
                  value={config.realityModel.incidents.plannedPause.duration}
                />
              </div>
            </div>
            <div className="sim-incident-row">
              <span className="sim-incident-row-label">Ungeplante Pause</span>
              <Toggle
                checked={config.realityModel.incidents.unplannedPause.enabled}
                label="Ungeplante Pause aktiv"
                onChange={(enabled) =>
                  updateIncident("unplannedPause", {
                    ...config.realityModel.incidents.unplannedPause,
                    enabled,
                  })
                }
              />
              <div className="sim-incident-values">
                <div className="sim-trigger-field">
                  <NumberInput
                    label="Rate ungeplanter Pausen je Betriebsstunde"
                    onChange={(ratePerOperatingHour) =>
                      updateIncident("unplannedPause", {
                        ...config.realityModel.incidents.unplannedPause,
                        ratePerOperatingHour,
                      })
                    }
                    step={0.01}
                    value={config.realityModel.incidents.unplannedPause.ratePerOperatingHour}
                  />
                  je Betriebsstd.
                </div>
                <DistributionInputs
                  id="Ungeplante Pausendauer"
                  onChange={(duration) =>
                    updateIncident("unplannedPause", {
                      ...config.realityModel.incidents.unplannedPause,
                      duration,
                    })
                  }
                  value={config.realityModel.incidents.unplannedPause.duration}
                />
              </div>
            </div>
            <div className="sim-incident-row sim-incident-row--defect">
              <span className="sim-incident-row-label">Technischer Defekt</span>
              <Toggle
                checked={config.realityModel.incidents.technicalDefect.enabled}
                label="Technischer Defekt aktiv"
                onChange={(enabled) =>
                  updateIncident("technicalDefect", {
                    ...config.realityModel.incidents.technicalDefect,
                    enabled,
                  })
                }
              />
              <div className="sim-incident-values">
                <div className="sim-trigger-field">
                  <NumberInput
                    label="Defektrate je Betriebsstunde"
                    onChange={(ratePerOperatingHour) =>
                      updateIncident("technicalDefect", {
                        ...config.realityModel.incidents.technicalDefect,
                        ratePerOperatingHour,
                      })
                    }
                    step={0.01}
                    value={config.realityModel.incidents.technicalDefect.ratePerOperatingHour}
                  />
                  je Betriebsstd.
                </div>
                <DistributionInputs
                  id="Defektdauer"
                  onChange={(duration) =>
                    updateIncident("technicalDefect", {
                      ...config.realityModel.incidents.technicalDefect,
                      duration,
                    })
                  }
                  value={config.realityModel.incidents.technicalDefect.duration}
                />
                <div className="sim-day-out-field">
                  Tagesausfall
                  <NumberInput
                    label="Wahrscheinlichkeit Tagesausfall in Prozent"
                    max={100}
                    onChange={(percent) =>
                      updateIncident("technicalDefect", {
                        ...config.realityModel.incidents.technicalDefect,
                        dayOutageProbability: percent / 100,
                      })
                    }
                    value={config.realityModel.incidents.technicalDefect.dayOutageProbability * 100}
                  />
                  %
                </div>
              </div>
            </div>
          </section>

          <section className="sim-editor-card sim-reproducibility-card">
            <header className="sim-editor-section-heading">
              <div>
                <h3>Reproduzierbarkeit</h3>
                <p>Gleicher Seed und gleiche Parameter erzeugen denselben Lauf.</p>
              </div>
              <ParameterTag kind="Simulation" />
            </header>
            <div className="sim-reproducibility-field">
              Seed
              <NumberInput
                label="Seed"
                min={1}
                onChange={(seed) => onChange({ ...config, seed })}
                value={config.seed}
              />
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "TUNING" ? (
        <div className="sim-editor-tab-content">
          <div className="sim-experiment-warning">
            <ParameterTag kind="Experiment" />
            <p>
              Diese Werte gelten nur lokal. Der Worker verwendet weiterhin die unveränderte
              Produktions-Baseline.
            </p>
          </div>
          <section className="sim-editor-card">
            <header className="sim-editor-section-heading">
              <div>
                <h3>Dauerprognose</h3>
                <p>
                  Produktionswert und Kandidat können einzeln verglichen und zurückgesetzt werden.
                </p>
              </div>
              <Button
                onClick={() =>
                  onChange({
                    ...config,
                    forecastTuning: {
                      ...config.forecastTuning,
                      forecast: { ...DEFAULT_FORECAST_TUNING_PROFILE },
                    },
                  })
                }
              >
                <RotateCcw aria-hidden="true" /> Alle zurücksetzen
              </Button>
            </header>
            <div className="sim-tuning-table">
              <div className="sim-tuning-head">
                <span>Parameter</span>
                <span>Produktion</span>
                <span>Kandidat</span>
                <span />
              </div>
              {FORECAST_FIELDS.map((field) => (
                <div className="sim-tuning-row" key={field.key}>
                  <div>
                    <strong>{field.label}</strong>
                    <small>{field.help}</small>
                  </div>
                  <output>{DEFAULT_FORECAST_TUNING_PROFILE[field.key]}</output>
                  <NumberInput
                    label={`${field.label}, Kandidat`}
                    max={field.max}
                    min={field.min}
                    onChange={(value) => updateForecast(field.key, value)}
                    step={field.step ?? 1}
                    value={config.forecastTuning.forecast[field.key]}
                  />
                  <button
                    aria-label={`${field.label} zurücksetzen`}
                    onClick={() =>
                      updateForecast(field.key, DEFAULT_FORECAST_TUNING_PROFILE[field.key])
                    }
                    title="Auf Produktionswert zurücksetzen"
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="sim-editor-card">
            <header className="sim-editor-section-heading">
              <div>
                <h3>Adaptiver Voraufruf</h3>
                <p>Technische Werte bleiben außerhalb der produktiven Administration.</p>
              </div>
              <Button
                onClick={() =>
                  onChange({
                    ...config,
                    forecastTuning: {
                      ...config.forecastTuning,
                      precall: { ...DEFAULT_PRECALL_TUNING_PROFILE },
                    },
                  })
                }
              >
                <RotateCcw aria-hidden="true" /> Alle zurücksetzen
              </Button>
            </header>
            <div className="sim-tuning-table">
              <div className="sim-tuning-head">
                <span>Parameter</span>
                <span>Produktion</span>
                <span>Kandidat</span>
                <span />
              </div>
              {PRECALL_FIELDS.map((field) => (
                <div className="sim-tuning-row" key={field.key}>
                  <div>
                    <strong>{field.label}</strong>
                    <small>{field.help}</small>
                  </div>
                  <output>{DEFAULT_PRECALL_TUNING_PROFILE[field.key]}</output>
                  <NumberInput
                    label={`${field.label}, Kandidat`}
                    max={field.max}
                    min={field.min}
                    onChange={(value) => updatePrecall(field.key, value)}
                    step={field.step ?? 1}
                    value={config.forecastTuning.precall[field.key]}
                  />
                  <button
                    aria-label={`${field.label} zurücksetzen`}
                    onClick={() =>
                      updatePrecall(field.key, DEFAULT_PRECALL_TUNING_PROFILE[field.key])
                    }
                    title="Auf Produktionswert zurücksetzen"
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="sim-editor-card sim-batch-config">
            <header className="sim-editor-section-heading">
              <div>
                <h3>A/B-Stichprobe</h3>
                <p>Baseline und Kandidat verwenden dieselben aufeinanderfolgenden Seeds.</p>
              </div>
              <ParameterTag kind="Experiment" />
            </header>
            <div className="sim-form-field">
              <span>Anzahl Läufe</span>
              <NumberInput
                label="Anzahl A/B-Läufe"
                min={5}
                max={100}
                onChange={(comparisonRuns) =>
                  onChange({
                    ...config,
                    forecastTuning: { ...config.forecastTuning, comparisonRuns },
                  })
                }
                value={config.forecastTuning.comparisonRuns}
              />
            </div>
          </section>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="sim-editor-errors" role="alert">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}
    </SidePanel>
  );
}
