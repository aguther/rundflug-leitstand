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

type DistributionKey = keyof SimulationConfig["phases"];
type DistributionValue = keyof TriangularDistribution;

const PHASE_LABELS: Record<DistributionKey, string> = {
  boarding: "Boarding",
  flight: "Flug",
  deboarding: "Deboarding",
  buffer: "Puffer",
};

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
  const updatePhase = (phase: DistributionKey, value: TriangularDistribution) => {
    onChange({ ...config, phases: { ...config.phases, [phase]: value } });
  };
  const updateIncident = <Key extends keyof SimulationConfig["incidents"]>(
    key: Key,
    value: SimulationConfig["incidents"][Key],
  ) => onChange({ ...config, incidents: { ...config.incidents, [key]: value } });

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
          <small>Dreiecksverteilungen und Störereignisse</small>
        </span>
      }
    >
      <section className="sim-editor-card">
        <h3>Zeitmodell</h3>
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
                value={config.phases[phase]}
              />
            </div>
          ))}
        </div>
        <p className="sim-editor-hint">Es gilt Minimum ≤ typisch ≤ Maximum.</p>
      </section>

      <section className="sim-editor-card">
        <h3>Betriebsereignisse</h3>
        <div className="sim-incident-head">
          <span>Ereignis</span>
          <span>Aktiv</span>
          <span>Auslöser und Dauer (Minimum / typisch / Maximum)</span>
        </div>
        <div className="sim-incident-row">
          <span className="sim-incident-row-label">Tanken</span>
          <Toggle
            checked={config.incidents.refueling.enabled}
            label="Tanken aktiv"
            onChange={(enabled) =>
              updateIncident("refueling", { ...config.incidents.refueling, enabled })
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
                    ...config.incidents.refueling,
                    everyRotations,
                  })
                }
                value={config.incidents.refueling.everyRotations}
              />
              Umläufe
            </div>
            <DistributionInputs
              id="Tankdauer"
              onChange={(duration) =>
                updateIncident("refueling", { ...config.incidents.refueling, duration })
              }
              value={config.incidents.refueling.duration}
            />
          </div>
        </div>
        <div className="sim-incident-row">
          <span className="sim-incident-row-label">Geplante Pause</span>
          <Toggle
            checked={config.incidents.plannedPause.enabled}
            label="Geplante Pause aktiv"
            onChange={(enabled) =>
              updateIncident("plannedPause", { ...config.incidents.plannedPause, enabled })
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
                    ...config.incidents.plannedPause,
                    everyOperatingMinutes,
                  })
                }
                value={config.incidents.plannedPause.everyOperatingMinutes}
              />
              Betriebsmin.
            </div>
            <DistributionInputs
              id="Geplante Pausendauer"
              onChange={(duration) =>
                updateIncident("plannedPause", { ...config.incidents.plannedPause, duration })
              }
              value={config.incidents.plannedPause.duration}
            />
          </div>
        </div>
        <div className="sim-incident-row">
          <span className="sim-incident-row-label">Ungeplante Pause</span>
          <Toggle
            checked={config.incidents.unplannedPause.enabled}
            label="Ungeplante Pause aktiv"
            onChange={(enabled) =>
              updateIncident("unplannedPause", { ...config.incidents.unplannedPause, enabled })
            }
          />
          <div className="sim-incident-values">
            <div className="sim-trigger-field">
              <NumberInput
                label="Rate ungeplanter Pausen je Betriebsstunde"
                min={0}
                onChange={(ratePerOperatingHour) =>
                  updateIncident("unplannedPause", {
                    ...config.incidents.unplannedPause,
                    ratePerOperatingHour,
                  })
                }
                step={0.01}
                value={config.incidents.unplannedPause.ratePerOperatingHour}
              />
              je Betriebsstd.
            </div>
            <DistributionInputs
              id="Ungeplante Pausendauer"
              onChange={(duration) =>
                updateIncident("unplannedPause", { ...config.incidents.unplannedPause, duration })
              }
              value={config.incidents.unplannedPause.duration}
            />
          </div>
        </div>
        <div className="sim-incident-row sim-incident-row--defect">
          <span className="sim-incident-row-label">Technischer Defekt</span>
          <Toggle
            checked={config.incidents.technicalDefect.enabled}
            label="Technischer Defekt aktiv"
            onChange={(enabled) =>
              updateIncident("technicalDefect", {
                ...config.incidents.technicalDefect,
                enabled,
              })
            }
          />
          <div className="sim-incident-values">
            <div className="sim-trigger-field">
              <NumberInput
                label="Defektrate je Betriebsstunde"
                min={0}
                onChange={(ratePerOperatingHour) =>
                  updateIncident("technicalDefect", {
                    ...config.incidents.technicalDefect,
                    ratePerOperatingHour,
                  })
                }
                step={0.01}
                value={config.incidents.technicalDefect.ratePerOperatingHour}
              />
              je Betriebsstd.
            </div>
            <DistributionInputs
              id="Defektdauer"
              onChange={(duration) =>
                updateIncident("technicalDefect", {
                  ...config.incidents.technicalDefect,
                  duration,
                })
              }
              value={config.incidents.technicalDefect.duration}
            />
            <div className="sim-day-out-field">
              Tagesausfall
              <NumberInput
                label="Wahrscheinlichkeit Tagesausfall in Prozent"
                max={100}
                onChange={(percent) =>
                  updateIncident("technicalDefect", {
                    ...config.incidents.technicalDefect,
                    dayOutageProbability: percent / 100,
                  })
                }
                value={config.incidents.technicalDefect.dayOutageProbability * 100}
              />
              %
            </div>
          </div>
        </div>
      </section>

      <section className="sim-editor-card sim-reproducibility-card">
        <h3>Reproduzierbarkeit</h3>
        <div className="sim-reproducibility-field">
          Seed
          <NumberInput
            label="Seed"
            min={1}
            onChange={(seed) => onChange({ ...config, seed })}
            value={config.seed}
          />
        </div>
        <p>Gleicher Seed + gleiche Parameter = gleicher Lauf.</p>
      </section>

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
