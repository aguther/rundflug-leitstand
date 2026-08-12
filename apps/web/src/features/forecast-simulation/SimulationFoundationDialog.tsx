import { AlertTriangle, Download, FileJson, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button, ModalDialog } from "../../design-system/components";
import {
  calculateSimulationDemandSummary,
  SIMULATION_PRESET_LABELS,
  type SimulationConfig,
  type SimulationPresetId,
  simulationConfigForPreset,
  validateSimulationConfig,
} from "./model";
import {
  excludeUnresolvedPlannedOperations,
  parseSimulationPlanFile,
  SimulationPlanImportError,
  type SimulationPlanImportPreview,
} from "./simulation-plan-import";
import {
  createSimulationScenarioTemplate,
  simulationScenarioTemplateFileName,
} from "./simulation-scenario-template";

type FoundationTab = "SCENARIO" | "JSON";

interface LoadedSimulationFoundation {
  config: SimulationConfig;
  format: SimulationPlanImportPreview["format"];
  sourceName: string;
}

interface SimulationFoundationDialogProps {
  activeConfig: SimulationConfig;
  onClose: () => void;
  onLoad: (foundation: LoadedSimulationFoundation) => void;
}

function downloadJson(value: unknown, fileName: string): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function nextSimulationVariantName(
  requestedName: string,
  existingNames: readonly string[],
): string {
  const normalized = requestedName.trim().slice(0, 80) || "Neue Variante";
  const occupied = new Set(existingNames);
  if (!occupied.has(normalized)) return normalized;
  for (let suffixNumber = 2; suffixNumber < 10_000; suffixNumber += 1) {
    const suffix = ` (${suffixNumber})`;
    const candidate = `${normalized.slice(0, 80 - suffix.length).trimEnd()}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  return `${normalized.slice(0, 71).trimEnd()} (${crypto.randomUUID().slice(0, 6)})`;
}

export function SimulationFoundationDialog({
  activeConfig,
  onClose,
  onLoad,
}: SimulationFoundationDialogProps) {
  const [tab, setTab] = useState<FoundationTab>("SCENARIO");
  const [selectedPreset, setSelectedPreset] = useState<SimulationPresetId>(activeConfig.preset);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SimulationPlanImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [excludeUnresolvedPlans, setExcludeUnresolvedPlans] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scenarioTabRef = useRef<HTMLButtonElement>(null);
  const jsonTabRef = useRef<HTMLButtonElement>(null);
  const selectedScenarioConfig = simulationConfigForPreset(selectedPreset);
  const preparedImportedConfig = preview
    ? preview.counts.unresolvedAfterCurrentRotation > 0 && excludeUnresolvedPlans
      ? excludeUnresolvedPlannedOperations(preview)
      : preview.config
    : null;
  const validationErrors = preparedImportedConfig
    ? validateSimulationConfig(preparedImportedConfig)
    : [];
  const demandSummary = preview ? calculateSimulationDemandSummary(preview.config) : null;

  const selectTab = (nextTab: FoundationTab) => {
    setTab(nextTab);
    setImportError(null);
  };

  const selectAndFocusTab = (nextTab: FoundationTab) => {
    selectTab(nextTab);
    (nextTab === "SCENARIO" ? scenarioTabRef : jsonTabRef).current?.focus();
  };

  const selectFile = (file: File | null) => {
    setSelectedFile(file);
    setPreview(null);
    setImportError(null);
    setExcludeUnresolvedPlans(false);
  };

  const openFilePicker = () => {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  };

  const inspectFile = async () => {
    if (!selectedFile) return;
    setImportError(null);
    setExcludeUnresolvedPlans(false);
    try {
      setPreview(await parseSimulationPlanFile(selectedFile, activeConfig));
    } catch (error) {
      setImportError(
        error instanceof SimulationPlanImportError
          ? error.message
          : "Die Simulationsgrundlage konnte nicht gelesen werden.",
      );
      setPreview(null);
    }
  };

  const downloadSelectedScenario = () => {
    const name = SIMULATION_PRESET_LABELS[selectedPreset];
    downloadJson(
      createSimulationScenarioTemplate(name, selectedScenarioConfig),
      simulationScenarioTemplateFileName(name),
    );
  };

  const loadSelectedScenario = () => {
    onLoad({
      sourceName: SIMULATION_PRESET_LABELS[selectedPreset],
      format: "rundflug-simulation-scenario",
      config: selectedScenarioConfig,
    });
  };

  const loadPreview = () => {
    if (!preview || !preparedImportedConfig || validationErrors.length > 0) return;
    onLoad({
      sourceName: preview.sourceName,
      format: preview.format,
      config: preparedImportedConfig,
    });
  };

  const fileFooter = preview ? (
    <>
      <Button onClick={onClose}>Abbrechen</Button>
      <Button
        disabled={
          (preview.counts.unresolvedAfterCurrentRotation > 0 && !excludeUnresolvedPlans) ||
          validationErrors.length > 0
        }
        onClick={loadPreview}
        variant="primary"
      >
        Als neue Variante laden
      </Button>
    </>
  ) : (
    <>
      <Button onClick={onClose}>Abbrechen</Button>
      <Button disabled={!selectedFile} onClick={() => void inspectFile()} variant="primary">
        Datei prüfen
      </Button>
    </>
  );

  return (
    <ModalDialog
      bodyClassName="sim-foundation-dialog"
      description="Szenario wählen oder JSON-Datei importieren."
      footer={
        tab === "SCENARIO" ? (
          <>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button onClick={loadSelectedScenario} variant="primary">
              Als neue Variante laden
            </Button>
          </>
        ) : (
          fileFooter
        )
      }
      initialFocusSelector='[role="tab"][aria-selected="true"]'
      onClose={onClose}
      open
      size={
        preview?.category === "OPERATIONAL" || preview?.config.operationalModel ? "wide" : "default"
      }
      title={
        <span className="sim-foundation-title">
          <FileJson aria-hidden="true" />
          Simulationsgrundlage laden
        </span>
      }
    >
      <div
        aria-label="Quelle der Simulationsgrundlage"
        className="sim-foundation-tabs"
        role="tablist"
      >
        <button
          aria-controls="sim-foundation-scenario"
          aria-selected={tab === "SCENARIO"}
          id="sim-foundation-scenario-tab"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "End") {
              event.preventDefault();
              selectAndFocusTab("JSON");
            }
          }}
          onClick={() => selectTab("SCENARIO")}
          ref={scenarioTabRef}
          role="tab"
          tabIndex={tab === "SCENARIO" ? 0 : -1}
          type="button"
        >
          Szenario
        </button>
        <button
          aria-controls="sim-foundation-json"
          aria-selected={tab === "JSON"}
          id="sim-foundation-json-tab"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home") {
              event.preventDefault();
              selectAndFocusTab("SCENARIO");
            }
          }}
          onClick={() => selectTab("JSON")}
          ref={jsonTabRef}
          role="tab"
          tabIndex={tab === "JSON" ? 0 : -1}
          type="button"
        >
          JSON-Datei
        </button>
      </div>

      {tab === "SCENARIO" ? (
        <div
          aria-labelledby="sim-foundation-scenario-tab"
          className="sim-foundation-panel"
          id="sim-foundation-scenario"
          role="tabpanel"
        >
          <fieldset className="sim-scenario-options">
            <legend className="visually-hidden">Szenario wählen</legend>
            {(Object.keys(SIMULATION_PRESET_LABELS) as SimulationPresetId[]).map((preset) => (
              <label key={preset}>
                <input
                  checked={selectedPreset === preset}
                  name="simulation-scenario"
                  onChange={() => setSelectedPreset(preset)}
                  type="radio"
                  value={preset}
                />
                <span>{SIMULATION_PRESET_LABELS[preset]}</span>
              </label>
            ))}
          </fieldset>
          <button
            className="sim-scenario-download"
            onClick={downloadSelectedScenario}
            type="button"
          >
            <Download aria-hidden="true" />
            Vorlage als JSON herunterladen
          </button>
        </div>
      ) : (
        <div
          aria-labelledby="sim-foundation-json-tab"
          className="sim-foundation-panel"
          id="sim-foundation-json"
          role="tabpanel"
        >
          <input
            accept=".json,application/json"
            className="visually-hidden"
            onChange={(event) => selectFile(event.currentTarget.files?.[0] ?? null)}
            ref={fileInputRef}
            type="file"
          />
          {!preview ? (
            <div className="sim-foundation-file">
              <Upload aria-hidden="true" />
              <strong>JSON-Datei auswählen</strong>
              <p>Simulationsplan, Stammdaten-Template oder Szenario-Vorlage · max. 1 MiB</p>
              <Button onClick={openFilePicker}>
                {selectedFile ? "Andere Datei wählen" : "Datei auswählen"}
              </Button>
              {selectedFile ? <small>{selectedFile.name}</small> : null}
            </div>
          ) : null}
          {importError ? (
            <p className="sim-editor-errors" role="alert">
              {importError}
            </p>
          ) : null}
          {preview ? (
            <div className="sim-plan-import-preview">
              <header>
                <div>
                  <span>Quelle</span>
                  <strong>{preview.sourceName}</strong>
                </div>
                <div>
                  <span>Format</span>
                  <strong>{preview.format}</strong>
                </div>
              </header>
              {preview.category === "SCENARIO" ? (
                <dl className="sim-scenario-import-summary">
                  <div>
                    <dt>Szenario</dt>
                    <dd>{SIMULATION_PRESET_LABELS[preview.config.preset]}</dd>
                  </div>
                  <div>
                    <dt>Flugzeuge</dt>
                    <dd>{preview.counts.aircraft}</dd>
                  </div>
                  <div>
                    <dt>Nachfrage</dt>
                    <dd>Ø {demandSummary?.averagePersonsPerHour ?? 0} Pers./Std.</dd>
                  </div>
                  {preview.config.operationalModel ? (
                    <>
                      <div>
                        <dt>Gates</dt>
                        <dd>{preview.counts.gates}</dd>
                      </div>
                      <div>
                        <dt>Ressourcengruppen</dt>
                        <dd>{preview.counts.resourceGroups}</dd>
                      </div>
                      <div>
                        <dt>aktive Piloten</dt>
                        <dd>{preview.counts.pilots}</dd>
                      </div>
                      <div>
                        <dt>Produkte</dt>
                        <dd>{preview.counts.products}</dd>
                      </div>
                      <div>
                        <dt>Planeinträge</dt>
                        <dd>{preview.counts.plannedOperations}</dd>
                      </div>
                      <div>
                        <dt>Regeln</dt>
                        <dd>{preview.counts.recurringRules}</dd>
                      </div>
                    </>
                  ) : null}
                </dl>
              ) : (
                <dl>
                  <div>
                    <dt>Gates</dt>
                    <dd>{preview.counts.gates}</dd>
                  </div>
                  <div>
                    <dt>Ressourcengruppen</dt>
                    <dd>{preview.counts.resourceGroups}</dd>
                  </div>
                  <div>
                    <dt>Flugzeuge</dt>
                    <dd>{preview.counts.aircraft}</dd>
                  </div>
                  <div>
                    <dt>aktive Piloten</dt>
                    <dd>{preview.counts.pilots}</dd>
                  </div>
                  <div>
                    <dt>Produkte</dt>
                    <dd>{preview.counts.products}</dd>
                  </div>
                  <div>
                    <dt>Planeinträge</dt>
                    <dd>{preview.counts.plannedOperations}</dd>
                  </div>
                  <div>
                    <dt>Regeln</dt>
                    <dd>{preview.counts.recurringRules}</dd>
                  </div>
                </dl>
              )}
              {preview.warnings.map((warning) => (
                <p className="sim-plan-import-warning" key={warning}>
                  <AlertTriangle aria-hidden="true" /> {warning}
                </p>
              ))}
              {preview.counts.unresolvedAfterCurrentRotation > 0 ? (
                <label className="sim-plan-import-exclusion">
                  <input
                    checked={excludeUnresolvedPlans}
                    onChange={(event) => setExcludeUnresolvedPlans(event.currentTarget.checked)}
                    type="checkbox"
                  />{" "}
                  Unaufgelöste umlaufgebundene Planeinträge für diese Variante ausdrücklich
                  ausschließen
                </label>
              ) : null}
              {validationErrors.length > 0 ? (
                <div className="sim-editor-errors" role="alert">
                  <strong>Die Variante ist noch nicht lauffähig:</strong>
                  <ul>
                    {validationErrors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="sim-editor-hint">
                Nicht enthalten: Tickets, Warteschlangen, Gastdaten, aktuelle Flugzeugzustände,
                Ereignisverlauf, Audit oder Prognose-Snapshots.
              </p>
              <Button
                className="sim-foundation-change-file"
                onClick={() => {
                  selectFile(null);
                  openFilePicker();
                }}
              >
                Andere Datei wählen
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </ModalDialog>
  );
}
