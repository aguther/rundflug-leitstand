import {
  AlertTriangle,
  Download,
  FileJson,
  Settings2,
  TableProperties,
  Upload,
} from "lucide-react";
import { type KeyboardEvent, type RefObject, useRef, useState } from "react";

import { Button, ModalDialog } from "../../design-system/components";
import { CalibrationCsvError, calibrateFromCsv } from "./csv-calibration";
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

type ImportTab = "SCENARIO" | "JSON" | "CSV";

interface LoadedSimulationScenario {
  kind: "SCENARIO";
  config: SimulationConfig;
  format: SimulationPlanImportPreview["format"];
  sourceName: string;
}

interface LoadedSimulationCalibration {
  kind: "CALIBRATION";
  config: SimulationConfig;
  excludedRows: number;
  validRows: number;
}

export type SimulationImportResult = LoadedSimulationScenario | LoadedSimulationCalibration;

interface SimulationImportDialogProps {
  activeConfig: SimulationConfig;
  onClose: () => void;
  onImport: (result: SimulationImportResult) => void;
}

const IMPORT_TABS = [
  { id: "SCENARIO", label: "Szenario", Icon: Settings2 },
  { id: "JSON", label: "Simulationsdatei (JSON)", Icon: FileJson },
  { id: "CSV", label: "Kalibrierung (CSV)", Icon: TableProperties },
] as const;

const MAX_CALIBRATION_CSV_FILE_BYTES = 2 * 1024 * 1024;

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

function prepareImportedConfig(
  preview: SimulationPlanImportPreview | null,
  excludeUnresolvedPlans: boolean,
): SimulationConfig | null {
  if (!preview) return null;
  if (preview.counts.unresolvedAfterCurrentRotation > 0 && excludeUnresolvedPlans) {
    return excludeUnresolvedPlannedOperations(preview);
  }
  return preview.config;
}

function SimulationScenarioPanel({
  onDownload,
  onSelectPreset,
  selectedPreset,
}: Readonly<{
  onDownload: () => void;
  onSelectPreset: (preset: SimulationPresetId) => void;
  selectedPreset: SimulationPresetId;
}>) {
  return (
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
              onChange={() => onSelectPreset(preset)}
              type="radio"
              value={preset}
            />
            <span>{SIMULATION_PRESET_LABELS[preset]}</span>
          </label>
        ))}
      </fieldset>
      <button className="sim-scenario-download" onClick={onDownload} type="button">
        <Download aria-hidden="true" />
        Vorlage als JSON herunterladen
      </button>
    </div>
  );
}

function SimulationImportSummary({ preview }: Readonly<{ preview: SimulationPlanImportPreview }>) {
  if (preview.category !== "SCENARIO") {
    return (
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
    );
  }
  const demandSummary = calculateSimulationDemandSummary(preview.config);
  return (
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
        <dd>Ø {demandSummary.averagePersonsPerHour} Pers./Std.</dd>
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
  );
}

function SimulationImportPreviewPanel({
  excludeUnresolvedPlans,
  onChangeFile,
  onExcludeUnresolvedPlans,
  preview,
  validationErrors,
}: Readonly<{
  excludeUnresolvedPlans: boolean;
  onChangeFile: () => void;
  onExcludeUnresolvedPlans: (exclude: boolean) => void;
  preview: SimulationPlanImportPreview;
  validationErrors: readonly string[];
}>) {
  return (
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
      <SimulationImportSummary preview={preview} />
      {preview.warnings.map((warning) => (
        <p className="sim-plan-import-warning" key={warning}>
          <AlertTriangle aria-hidden="true" /> {warning}
        </p>
      ))}
      {preview.counts.unresolvedAfterCurrentRotation > 0 ? (
        <label className="sim-plan-import-exclusion">
          <input
            checked={excludeUnresolvedPlans}
            onChange={(event) => onExcludeUnresolvedPlans(event.currentTarget.checked)}
            type="checkbox"
          />{" "}
          Unaufgelöste umlaufgebundene Planeinträge für diese Variante ausdrücklich ausschließen
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
      <Button className="sim-foundation-change-file" onClick={onChangeFile}>
        Andere Datei wählen
      </Button>
    </div>
  );
}

function SimulationJsonPanel({
  excludeUnresolvedPlans,
  fileInputRef,
  importError,
  onChangeFile,
  onExcludeUnresolvedPlans,
  onOpenFilePicker,
  onSelectFile,
  preview,
  selectedFile,
  validationErrors,
}: Readonly<{
  excludeUnresolvedPlans: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  importError: string | null;
  onChangeFile: () => void;
  onExcludeUnresolvedPlans: (exclude: boolean) => void;
  onOpenFilePicker: () => void;
  onSelectFile: (file: File | null) => void;
  preview: SimulationPlanImportPreview | null;
  selectedFile: File | null;
  validationErrors: readonly string[];
}>) {
  return (
    <div
      aria-labelledby="sim-foundation-json-tab"
      className="sim-foundation-panel"
      id="sim-foundation-json"
      role="tabpanel"
    >
      <input
        accept=".json,application/json"
        className="visually-hidden"
        onChange={(event) => onSelectFile(event.currentTarget.files?.[0] ?? null)}
        ref={fileInputRef}
        type="file"
      />
      {!preview ? (
        <div className="sim-foundation-file">
          <Upload aria-hidden="true" />
          <strong>JSON-Datei auswählen</strong>
          <p>Simulationsplan, Stammdaten-Template oder Szenario-Vorlage · max. 1 MiB</p>
          <Button onClick={onOpenFilePicker}>
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
        <SimulationImportPreviewPanel
          excludeUnresolvedPlans={excludeUnresolvedPlans}
          onChangeFile={onChangeFile}
          onExcludeUnresolvedPlans={onExcludeUnresolvedPlans}
          preview={preview}
          validationErrors={validationErrors}
        />
      ) : null}
    </div>
  );
}

function SimulationCsvPanel({
  fileInputRef,
  importError,
  onOpenFilePicker,
  onSelectFile,
  selectedFile,
}: Readonly<{
  fileInputRef: RefObject<HTMLInputElement | null>;
  importError: string | null;
  onOpenFilePicker: () => void;
  onSelectFile: (file: File | null) => void;
  selectedFile: File | null;
}>) {
  return (
    <div
      aria-labelledby="sim-foundation-csv-tab"
      className="sim-foundation-panel"
      id="sim-foundation-csv"
      role="tabpanel"
    >
      <input
        accept=".csv,text/csv"
        className="visually-hidden"
        onChange={(event) => onSelectFile(event.currentTarget.files?.[0] ?? null)}
        ref={fileInputRef}
        type="file"
      />
      <div className="sim-foundation-file">
        <TableProperties aria-hidden="true" />
        <strong>CSV-Datei auswählen</strong>
        <p>Abgeschlossene synthetische Umläufe für die Phasenkalibrierung · max. 2 MiB</p>
        <Button onClick={onOpenFilePicker}>
          {selectedFile ? "Andere Datei wählen" : "Datei auswählen"}
        </Button>
        {selectedFile ? <small>{selectedFile.name}</small> : null}
      </div>
      {importError ? (
        <p className="sim-editor-errors" role="alert">
          {importError}
        </p>
      ) : null}
    </div>
  );
}

function SimulationImportFooter({
  canLoadPreview,
  importingCsv,
  onClose,
  onImportCsv,
  onInspectFile,
  onLoadPreview,
  onLoadScenario,
  preview,
  selectedFile,
  tab,
}: Readonly<{
  canLoadPreview: boolean;
  importingCsv: boolean;
  onClose: () => void;
  onImportCsv: () => void;
  onInspectFile: () => void;
  onLoadPreview: () => void;
  onLoadScenario: () => void;
  preview: SimulationPlanImportPreview | null;
  selectedFile: File | null;
  tab: ImportTab;
}>) {
  if (tab === "SCENARIO") {
    return (
      <>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button onClick={onLoadScenario} variant="primary">
          Szenario laden
        </Button>
      </>
    );
  }
  if (tab === "JSON" && preview) {
    return (
      <>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button disabled={!canLoadPreview} onClick={onLoadPreview} variant="primary">
          Szenario laden
        </Button>
      </>
    );
  }
  if (tab === "CSV") {
    return (
      <>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button
          busy={importingCsv}
          disabled={!selectedFile}
          onClick={onImportCsv}
          variant="primary"
        >
          Kalibrierung anwenden
        </Button>
      </>
    );
  }
  return (
    <>
      <Button onClick={onClose}>Abbrechen</Button>
      <Button disabled={!selectedFile} onClick={onInspectFile} variant="primary">
        Datei prüfen
      </Button>
    </>
  );
}

export function SimulationImportDialog({
  activeConfig,
  onClose,
  onImport,
}: Readonly<SimulationImportDialogProps>) {
  const [tab, setTab] = useState<ImportTab>("SCENARIO");
  const [selectedPreset, setSelectedPreset] = useState<SimulationPresetId>(activeConfig.preset);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SimulationPlanImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [excludeUnresolvedPlans, setExcludeUnresolvedPlans] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scenarioTabRef = useRef<HTMLButtonElement>(null);
  const jsonTabRef = useRef<HTMLButtonElement>(null);
  const csvTabRef = useRef<HTMLButtonElement>(null);
  const selectedScenarioConfig = simulationConfigForPreset(selectedPreset);
  const preparedImportedConfig = prepareImportedConfig(preview, excludeUnresolvedPlans);
  const validationErrors = preparedImportedConfig
    ? validateSimulationConfig(preparedImportedConfig)
    : [];
  const canLoadPreview = Boolean(
    preview &&
      preparedImportedConfig &&
      validationErrors.length === 0 &&
      (preview.counts.unresolvedAfterCurrentRotation === 0 || excludeUnresolvedPlans),
  );

  const selectTab = (nextTab: ImportTab) => {
    if (nextTab === tab) return;
    setTab(nextTab);
    setSelectedFile(null);
    setPreview(null);
    setImportError(null);
    setExcludeUnresolvedPlans(false);
  };

  const selectAndFocusTab = (nextTab: ImportTab) => {
    selectTab(nextTab);
    const target =
      nextTab === "SCENARIO" ? scenarioTabRef : nextTab === "JSON" ? jsonTabRef : csvTabRef;
    target.current?.focus();
  };

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, currentTab: ImportTab) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = IMPORT_TABS.findIndex(({ id }) => id === currentTab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? IMPORT_TABS.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + IMPORT_TABS.length) %
            IMPORT_TABS.length;
    const nextTab = IMPORT_TABS[nextIndex]?.id;
    if (nextTab) selectAndFocusTab(nextTab);
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
    onImport({
      kind: "SCENARIO",
      sourceName: SIMULATION_PRESET_LABELS[selectedPreset],
      format: "rundflug-simulation-scenario",
      config: selectedScenarioConfig,
    });
  };

  const loadPreview = () => {
    if (!preview || !preparedImportedConfig || validationErrors.length > 0) return;
    onImport({
      kind: "SCENARIO",
      sourceName: preview.sourceName,
      format: preview.format,
      config: preparedImportedConfig,
    });
  };

  const importCsv = async () => {
    if (!selectedFile) return;
    setImportError(null);
    if (selectedFile.size > MAX_CALIBRATION_CSV_FILE_BYTES) {
      setImportError("Die CSV-Datei ist größer als 2 MiB.");
      return;
    }
    setImportingCsv(true);
    try {
      const calibration = calibrateFromCsv(
        await selectedFile.text(),
        activeConfig.realityModel.phases.buffer,
      );
      onImport({
        kind: "CALIBRATION",
        config: {
          ...activeConfig,
          realityModel: {
            ...activeConfig.realityModel,
            phases: calibration.suggestedPhases,
          },
        },
        excludedRows: calibration.excludedRows,
        validRows: calibration.validRows,
      });
    } catch (error) {
      setImportError(
        error instanceof CalibrationCsvError
          ? error.message
          : "Die Datei konnte nicht gelesen werden.",
      );
    } finally {
      setImportingCsv(false);
    }
  };

  const changeFile = () => {
    selectFile(null);
    openFilePicker();
  };

  return (
    <ModalDialog
      bodyClassName="sim-foundation-dialog"
      description="Wählen Sie, was Sie in das aktuelle Szenario übernehmen möchten."
      footer={
        <SimulationImportFooter
          canLoadPreview={canLoadPreview}
          importingCsv={importingCsv}
          onClose={onClose}
          onImportCsv={() => void importCsv()}
          onInspectFile={() => void inspectFile()}
          onLoadPreview={loadPreview}
          onLoadScenario={loadSelectedScenario}
          preview={preview}
          selectedFile={selectedFile}
          tab={tab}
        />
      }
      initialFocusSelector='[role="tab"][aria-selected="true"]'
      onClose={onClose}
      open
      size={
        preview?.category === "OPERATIONAL" || preview?.config.operationalModel ? "wide" : "default"
      }
      title="Importieren"
    >
      <div aria-label="Importquelle" className="sim-foundation-tabs" role="tablist">
        {IMPORT_TABS.map(({ Icon, id, label }) => (
          <button
            aria-controls={`sim-foundation-${id.toLowerCase()}`}
            aria-selected={tab === id}
            id={`sim-foundation-${id.toLowerCase()}-tab`}
            key={id}
            onClick={() => selectTab(id)}
            onKeyDown={(event) => navigateTabs(event, id)}
            ref={id === "SCENARIO" ? scenarioTabRef : id === "JSON" ? jsonTabRef : csvTabRef}
            role="tab"
            tabIndex={tab === id ? 0 : -1}
            type="button"
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === "SCENARIO" ? (
        <SimulationScenarioPanel
          onDownload={downloadSelectedScenario}
          onSelectPreset={setSelectedPreset}
          selectedPreset={selectedPreset}
        />
      ) : tab === "JSON" ? (
        <SimulationJsonPanel
          excludeUnresolvedPlans={excludeUnresolvedPlans}
          fileInputRef={fileInputRef}
          importError={importError}
          onChangeFile={changeFile}
          onExcludeUnresolvedPlans={setExcludeUnresolvedPlans}
          onOpenFilePicker={openFilePicker}
          onSelectFile={selectFile}
          preview={preview}
          selectedFile={selectedFile}
          validationErrors={validationErrors}
        />
      ) : (
        <SimulationCsvPanel
          fileInputRef={fileInputRef}
          importError={importError}
          onOpenFilePicker={openFilePicker}
          onSelectFile={selectFile}
          selectedFile={selectedFile}
        />
      )}
      <p className="sim-import-effect">
        {tab === "CSV"
          ? "Die Kalibrierung aktualisiert die Phasen des aktuellen Szenarios. Manuelle Ereignisse und der laufende Simulationsstand werden zurückgesetzt."
          : "Das geladene Szenario ersetzt die aktuelle Konfiguration. Manuelle Ereignisse und der laufende Simulationsstand werden zurückgesetzt."}
      </p>
    </ModalDialog>
  );
}
