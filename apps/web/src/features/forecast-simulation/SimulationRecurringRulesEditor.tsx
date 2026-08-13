import { Plus, Trash2 } from "lucide-react";

import { Button } from "../../design-system/components";
import type { SimulationConfig, SimulationRecurringOperationalRule } from "./model";

interface SimulationRecurringRulesEditorProps {
  config: SimulationConfig;
  onChange: (config: SimulationConfig) => void;
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recurringRuleDueLabel(
  rule: SimulationRecurringOperationalRule,
  remaining: number,
): string {
  if (remaining === 0) return "jetzt fällig";
  if (rule.triggerMetric === "OPERATING_MINUTES") {
    return `voraussichtlich in ${remaining} Betriebsminuten`;
  }
  const unit = remaining === 1 ? "Umlauf" : "Umläufen";
  return `voraussichtlich in ${remaining} ${unit}`;
}

export function SimulationRecurringRulesEditor({
  config,
  onChange,
}: Readonly<SimulationRecurringRulesEditorProps>) {
  const model = config.operationalModel;
  if (!model) return null;

  const replaceRule = (
    key: string,
    update: (rule: SimulationRecurringOperationalRule) => SimulationRecurringOperationalRule,
  ) => {
    onChange({
      ...config,
      recurringRules: (config.recurringRules ?? []).map((entry) =>
        entry.key === key ? update(entry) : entry,
      ),
    });
  };

  const addRule = () => {
    const existingRules = config.recurringRules ?? [];
    const aircraft = model.aircraft[0];
    const pilot = model.pilots[0];
    if (!aircraft && !pilot) return;
    const useAircraft = Boolean(aircraft);
    let sequence = existingRules.length + 1;
    while (existingRules.some((entry) => entry.key === `sim-rule-${sequence}`)) sequence += 1;
    onChange({
      ...config,
      recurringRules: [
        ...existingRules,
        {
          key: `sim-rule-${sequence}`,
          scopeType: useAircraft ? "AIRCRAFT" : "PILOT",
          scopeId: useAircraft ? (aircraft?.id ?? "") : (pilot?.id ?? ""),
          kind: useAircraft ? "REFUELING" : "PAUSE",
          triggerMetric: useAircraft ? "COMPLETED_ROTATIONS" : "OPERATING_MINUTES",
          intervalValue: aircraft?.refuelReminderThreshold ?? 5,
          progressValue: 0,
          minimumDurationMinutes: useAircraft ? 8 : 15,
          typicalDurationMinutes: useAircraft ? 12 : 20,
          maximumDurationMinutes: useAircraft ? 18 : 30,
        },
      ],
    });
  };

  return (
    <section className="sim-targeted-rules">
      <header>
        <h4>Zielbezogene Regeln</h4>
        <p>Eine zielbezogene Regel ersetzt für dieses Ziel den entsprechenden Standard.</p>
      </header>
      <div className="sim-plan-list">
        {(config.recurringRules ?? []).length === 0 ? (
          <p className="sim-editor-hint">Noch keine zielbezogene Regel vorhanden.</p>
        ) : null}
        {(config.recurringRules ?? []).map((rule) => {
          const targets =
            rule.scopeType === "AIRCRAFT"
              ? model.aircraft.map((entry) => ({
                  id: entry.id,
                  label: `${entry.registration} · ${entry.aircraftType}`,
                }))
              : model.pilots.map((entry) => ({
                  id: entry.id,
                  label: entry.operationalCode,
                }));
          const remaining = Math.max(0, rule.intervalValue - rule.progressValue);
          return (
            <article className="sim-plan-entry" key={rule.key}>
              <header>
                <div>
                  <strong>{rule.kind === "REFUELING" ? "Tanken" : "Pause"}</strong>
                  <small className="sim-rule-due">{recurringRuleDueLabel(rule, remaining)}</small>
                </div>
                <button
                  aria-label={`${rule.key} löschen`}
                  onClick={() =>
                    onChange({
                      ...config,
                      recurringRules: (config.recurringRules ?? []).filter(
                        (entry) => entry.key !== rule.key,
                      ),
                    })
                  }
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </header>
              <div className="sim-plan-grid">
                <label>
                  <span>Zielart</span>
                  <select
                    onChange={(event) => {
                      const scopeType = event.currentTarget.value as "AIRCRAFT" | "PILOT";
                      replaceRule(rule.key, (entry) => ({
                        ...entry,
                        scopeType,
                        scopeId:
                          scopeType === "AIRCRAFT"
                            ? (model.aircraft[0]?.id ?? "")
                            : (model.pilots[0]?.id ?? ""),
                        kind:
                          scopeType === "PILOT" && entry.kind === "REFUELING"
                            ? "PAUSE"
                            : entry.kind,
                      }));
                    }}
                    value={rule.scopeType}
                  >
                    <option value="AIRCRAFT">Flugzeug</option>
                    <option value="PILOT">Pilotencode</option>
                  </select>
                </label>
                <label>
                  <span>Ziel</span>
                  <select
                    onChange={(event) =>
                      replaceRule(rule.key, (entry) => ({
                        ...entry,
                        scopeId: event.currentTarget.value,
                      }))
                    }
                    value={rule.scopeId}
                  >
                    {targets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Art</span>
                  <select
                    onChange={(event) =>
                      replaceRule(rule.key, (entry) => ({
                        ...entry,
                        kind: event.currentTarget.value as "PAUSE" | "REFUELING",
                      }))
                    }
                    value={rule.kind}
                  >
                    <option value="PAUSE">Pause</option>
                    {rule.scopeType === "AIRCRAFT" ? (
                      <option value="REFUELING">Tanken</option>
                    ) : null}
                  </select>
                </label>
                <label>
                  <span>Auslöser</span>
                  <select
                    onChange={(event) =>
                      replaceRule(rule.key, (entry) => ({
                        ...entry,
                        triggerMetric: event.currentTarget.value as
                          | "COMPLETED_ROTATIONS"
                          | "OPERATING_MINUTES",
                      }))
                    }
                    value={rule.triggerMetric}
                  >
                    <option value="COMPLETED_ROTATIONS">Bestätigte Umläufe</option>
                    <option value="OPERATING_MINUTES">Betriebsminuten</option>
                  </select>
                </label>
                <label>
                  <span>Intervall</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      replaceRule(rule.key, (entry) => ({
                        ...entry,
                        intervalValue: numberValue(event.currentTarget.value, entry.intervalValue),
                      }))
                    }
                    type="number"
                    value={rule.intervalValue}
                  />
                </label>
                <label>
                  <span>Bestätigter Fortschritt</span>
                  <input
                    min={0}
                    onChange={(event) =>
                      replaceRule(rule.key, (entry) => ({
                        ...entry,
                        progressValue: numberValue(event.currentTarget.value, entry.progressValue),
                      }))
                    }
                    type="number"
                    value={rule.progressValue}
                  />
                </label>
              </div>
              <div className="sim-plan-duration">
                <span>Dauer Minimum / typisch / Maximum</span>
                {(
                  [
                    "minimumDurationMinutes",
                    "typicalDurationMinutes",
                    "maximumDurationMinutes",
                  ] as const
                ).map((field) => (
                  <input
                    aria-label={`${rule.key} ${field}`}
                    key={field}
                    min={1}
                    onChange={(event) =>
                      replaceRule(rule.key, (entry) => ({
                        ...entry,
                        [field]: numberValue(event.currentTarget.value, entry[field]),
                      }))
                    }
                    type="number"
                    value={rule[field]}
                  />
                ))}
                <small>Min.</small>
              </div>
            </article>
          );
        })}
      </div>
      <Button onClick={addRule}>
        <Plus aria-hidden="true" /> Regel hinzufügen
      </Button>
    </section>
  );
}
