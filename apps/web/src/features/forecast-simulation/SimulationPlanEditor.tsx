import type { OperationalPlanKind, OperationalPlanScope } from "@rundflug/contracts";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "../../design-system/components";
import { eventLocalDateTimeToIso, formatEventLocalDateTime } from "../../event-time";
import type { SimulationConfig, SimulationPlannedOperation, SimulationRotation } from "./model";

interface SimulationPlanEditorProps {
  config: SimulationConfig;
  rotations: readonly SimulationRotation[];
  onChange: (config: SimulationConfig) => void;
}

const KIND_LABELS: Record<OperationalPlanKind, string> = {
  PAUSE: "Pause",
  REFUELING: "Tanken",
  FLIGHT_SHOW: "Flugshow",
  WEATHER: "Wetter",
  TECHNICAL: "Technik",
  OTHER: "Sonstiges",
};

const SCOPE_LABELS: Record<OperationalPlanScope, string> = {
  EVENT: "Veranstaltung",
  RESOURCE_GROUP: "Ressourcengruppe",
  AIRCRAFT: "Flugzeug",
  PILOT: "Pilot",
};

function targetOptions(
  config: SimulationConfig,
  scopeType: OperationalPlanScope,
): Array<{ id: string; label: string }> {
  const model = config.operationalModel;
  if (!model) return [];
  if (scopeType === "EVENT") return [{ id: "event", label: "Gesamte Veranstaltung" }];
  if (scopeType === "RESOURCE_GROUP") {
    return model.resourceGroups.map((entry) => ({
      id: entry.id,
      label: `${entry.shortCode} · ${entry.name}`,
    }));
  }
  if (scopeType === "AIRCRAFT") {
    return model.aircraft.map((entry) => ({
      id: entry.id,
      label: `${entry.registration} · ${entry.aircraftType}`,
    }));
  }
  return model.pilots.map((entry) => ({
    id: entry.id,
    label: entry.operationalCode,
  }));
}

function defaultWindow(config: SimulationConfig): {
  earliestStartAt: string;
  latestStartAt: string;
} {
  const earliest = Math.min(
    Date.parse(config.schedule.operationsEndAt) - 10 * 60_000,
    Date.parse(config.schedule.operationsStartAt) + 60 * 60_000,
  );
  return {
    earliestStartAt: new Date(earliest).toISOString(),
    latestStartAt: new Date(earliest + 10 * 60_000).toISOString(),
  };
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function OperationStartFields({
  config,
  operation,
  replaceOperation,
  rotations,
}: Readonly<{
  config: SimulationConfig;
  operation: SimulationPlannedOperation;
  replaceOperation: (
    key: string,
    update: (operation: SimulationPlannedOperation) => SimulationPlannedOperation,
  ) => void;
  rotations: readonly SimulationRotation[];
}>) {
  if (operation.unresolvedAfterCurrentRotation) {
    return (
      <div className="sim-plan-unresolved" role="alert">
        <span>
          Der operative Bezugsumlauf ist nicht Teil des Imports. Vor dem Lauf ist eine Umwandlung
          oder der Ausschluss erforderlich.
        </span>
        <Button
          onClick={() => {
            const window = defaultWindow(config);
            replaceOperation(operation.key, (entry) => ({
              ...entry,
              startMode: "TIME_WINDOW",
              ...window,
              afterRotationId: null,
              unresolvedAfterCurrentRotation: false,
            }));
          }}
        >
          In Zeitfenster umwandeln
        </Button>
      </div>
    );
  }
  if (operation.startMode === "AFTER_CURRENT_ROTATION") {
    return (
      <label className="sim-plan-note">
        <span>Bezugsumlauf</span>
        <select
          onChange={(event) =>
            replaceOperation(operation.key, (entry) => ({
              ...entry,
              afterRotationId: event.currentTarget.value,
            }))
          }
          value={operation.afterRotationId ?? ""}
        >
          {rotations.map((rotation) => (
            <option key={rotation.id} value={rotation.id}>
              {rotation.communicationNumber} · {rotation.productCode ?? "SIM"}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div className="sim-plan-grid sim-plan-grid--times">
      {(["earliestStartAt", "latestStartAt"] as const).map((field) => (
        <label key={field}>
          <span>{field === "earliestStartAt" ? "Frühester Beginn" : "Spätester Beginn"}</span>
          <input
            onChange={(event) =>
              replaceOperation(operation.key, (entry) => ({
                ...entry,
                [field]: eventLocalDateTimeToIso(
                  event.currentTarget.value,
                  config.schedule.timeZone,
                ),
              }))
            }
            type="datetime-local"
            value={formatEventLocalDateTime(operation[field], config.schedule.timeZone)}
          />
        </label>
      ))}
    </div>
  );
}

export function SimulationPlanEditor({
  config,
  rotations,
  onChange,
}: Readonly<SimulationPlanEditorProps>) {
  const model = config.operationalModel;
  if (!model) {
    return (
      <div className="sim-editor-tab-content">
        <section className="sim-editor-card">
          <h3>Geplanter Flugtag</h3>
          <p className="sim-editor-hint">
            Planeinträge stehen zur Verfügung, sobald operative Stammdaten oder ein Simulationsplan
            importiert wurden.
          </p>
        </section>
      </div>
    );
  }

  const replaceOperation = (
    key: string,
    update: (operation: SimulationPlannedOperation) => SimulationPlannedOperation,
  ) => {
    onChange({
      ...config,
      plannedOperations: config.plannedOperations.map((entry) =>
        entry.key === key ? update(entry) : entry,
      ),
    });
  };

  const addOperation = () => {
    const window = defaultWindow(config);
    const key = `sim-plan-${String(config.plannedOperations.length + 1).padStart(3, "0")}`;
    onChange({
      ...config,
      plannedOperations: [
        ...config.plannedOperations,
        {
          key,
          scopeType: "EVENT",
          scopeId: "event",
          kind: "PAUSE",
          effectMode: "BLOCKING",
          durationMultiplierPercent: null,
          startMode: "TIME_WINDOW",
          earliestStartAt: window.earliestStartAt,
          latestStartAt: window.latestStartAt,
          afterRotationId: null,
          unresolvedAfterCurrentRotation: false,
          minimumDurationMinutes: 10,
          typicalDurationMinutes: 15,
          maximumDurationMinutes: 20,
          publicNote: "",
        },
      ],
    });
  };
  return (
    <div className="sim-editor-tab-content">
      <section className="sim-editor-card">
        <header className="sim-editor-section-heading">
          <div>
            <h3>Geplante Unterbrechungen und Flugshows</h3>
            <p>Der Seed bestimmt Beginn und Dauer innerhalb der angegebenen Bandbreiten.</p>
          </div>
          <span className="sim-parameter-tag sim-parameter-tag--simulation">Simulation</span>
        </header>
        <div className="sim-plan-list">
          {config.plannedOperations.length === 0 ? (
            <p className="sim-editor-hint">Noch keine Planeinträge vorhanden.</p>
          ) : null}
          {config.plannedOperations.map((operation) => {
            const targets = targetOptions(config, operation.scopeType);
            return (
              <article className="sim-plan-entry" key={operation.key}>
                <header>
                  <strong>{operation.key}</strong>
                  <button
                    aria-label={`${operation.key} entfernen`}
                    onClick={() =>
                      onChange({
                        ...config,
                        plannedOperations: config.plannedOperations.filter(
                          (entry) => entry.key !== operation.key,
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
                    <span>Art</span>
                    <select
                      onChange={(event) =>
                        replaceOperation(operation.key, (entry) => ({
                          ...entry,
                          kind: event.currentTarget.value as OperationalPlanKind,
                        }))
                      }
                      value={operation.kind}
                    >
                      {(Object.keys(KIND_LABELS) as OperationalPlanKind[]).map((kind) => (
                        <option key={kind} value={kind}>
                          {KIND_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Geltungsbereich</span>
                    <select
                      onChange={(event) => {
                        const scopeType = event.currentTarget.value as OperationalPlanScope;
                        const firstTarget = targetOptions(config, scopeType)[0];
                        replaceOperation(operation.key, (entry) => ({
                          ...entry,
                          scopeType,
                          scopeId: firstTarget?.id ?? "",
                          publicNote:
                            scopeType === "EVENT" || scopeType === "RESOURCE_GROUP"
                              ? entry.publicNote
                              : "",
                        }));
                      }}
                      value={operation.scopeType}
                    >
                      {(Object.keys(SCOPE_LABELS) as OperationalPlanScope[]).map((scope) => (
                        <option key={scope} value={scope}>
                          {SCOPE_LABELS[scope]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Auswirkung</span>
                    <select
                      onChange={(event) => {
                        const effectMode = event.currentTarget.value as "BLOCKING" | "SLOWDOWN";
                        replaceOperation(operation.key, (entry) => ({
                          ...entry,
                          effectMode,
                          durationMultiplierPercent:
                            effectMode === "SLOWDOWN"
                              ? (entry.durationMultiplierPercent ?? 150)
                              : null,
                        }));
                      }}
                      value={operation.effectMode ?? "BLOCKING"}
                    >
                      <option value="BLOCKING">Vollständige Einschränkung</option>
                      <option value="SLOWDOWN">Verzögerter Betrieb</option>
                    </select>
                  </label>
                  {(operation.effectMode ?? "BLOCKING") === "SLOWDOWN" ? (
                    <label>
                      <span>Verzögerungsfaktor (%)</span>
                      <input
                        max="300"
                        min="110"
                        onChange={(event) =>
                          replaceOperation(operation.key, (entry) => ({
                            ...entry,
                            durationMultiplierPercent: numberValue(event.currentTarget.value, 150),
                          }))
                        }
                        type="number"
                        value={operation.durationMultiplierPercent ?? 150}
                      />
                    </label>
                  ) : null}
                  <label>
                    <span>Ziel</span>
                    <select
                      onChange={(event) =>
                        replaceOperation(operation.key, (entry) => ({
                          ...entry,
                          scopeId: event.currentTarget.value,
                        }))
                      }
                      value={operation.scopeId}
                    >
                      {targets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Beginn</span>
                    <select
                      onChange={(event) => {
                        const startMode = event.currentTarget.value as
                          | "TIME_WINDOW"
                          | "AFTER_CURRENT_ROTATION";
                        replaceOperation(operation.key, (entry) => {
                          if (startMode === "AFTER_CURRENT_ROTATION") {
                            return {
                              ...entry,
                              startMode,
                              earliestStartAt: null,
                              latestStartAt: null,
                              afterRotationId: rotations[0]?.id ?? null,
                              unresolvedAfterCurrentRotation: false,
                            };
                          }
                          return {
                            ...entry,
                            startMode,
                            ...defaultWindow(config),
                            afterRotationId: null,
                            unresolvedAfterCurrentRotation: false,
                          };
                        });
                      }}
                      value={operation.startMode}
                    >
                      <option value="TIME_WINDOW">Im Zeitfenster</option>
                      <option disabled={rotations.length === 0} value="AFTER_CURRENT_ROTATION">
                        Nach simuliertem Umlauf
                      </option>
                    </select>
                  </label>
                </div>
                <OperationStartFields
                  config={config}
                  operation={operation}
                  replaceOperation={replaceOperation}
                  rotations={rotations}
                />
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
                      aria-label={`${operation.key} ${field}`}
                      key={field}
                      min={1}
                      onChange={(event) =>
                        replaceOperation(operation.key, (entry) => ({
                          ...entry,
                          [field]: numberValue(event.currentTarget.value, entry[field]),
                        }))
                      }
                      type="number"
                      value={operation[field]}
                    />
                  ))}
                  <small>Min.</small>
                </div>
                {operation.scopeType === "EVENT" || operation.scopeType === "RESOURCE_GROUP" ? (
                  <label className="sim-plan-note">
                    <span>Öffentlicher Hinweis (optional)</span>
                    <input
                      maxLength={160}
                      onChange={(event) =>
                        replaceOperation(operation.key, (entry) => ({
                          ...entry,
                          publicNote: event.currentTarget.value,
                        }))
                      }
                      type="text"
                      value={operation.publicNote}
                    />
                  </label>
                ) : null}
              </article>
            );
          })}
        </div>
        <Button onClick={addOperation}>
          <Plus aria-hidden="true" /> Planeintrag hinzufügen
        </Button>
      </section>
    </div>
  );
}
