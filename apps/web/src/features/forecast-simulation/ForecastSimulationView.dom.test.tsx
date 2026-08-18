// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForecastSimulationView } from "./ForecastSimulationView";
import type { SimulationConfig } from "./model";

const mocks = vi.hoisted(() => ({
  workers: [] as MockWorker[],
}));

class MockWorker {
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    mocks.workers.push(this);
  }
}

vi.mock("../../design-system/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("./engine", async () => {
  const actual = await vi.importActual<typeof import("./engine")>("./engine");
  const model = await vi.importActual<typeof import("./model")>("./model");
  const baselineResult = actual.runSimulation(model.simulationConfigForPreset("NORMAL"));
  return {
    ...actual,
    runSimulation: vi.fn((config: SimulationConfig) => ({ ...baselineResult, config })),
  };
});
vi.mock("./ForecastTimeline", () => ({
  ForecastTimeline: ({
    onSelectRotation,
    onShowHistory,
    result,
  }: {
    onSelectRotation: (rotationId: string) => void;
    onShowHistory: () => void;
    result: { rotations: Array<{ id: string }> };
  }) => (
    <section aria-label="Simulationsverlauf">
      <button onClick={() => onSelectRotation(result.rotations[0]?.id ?? "")} type="button">
        Ersten Umlauf auswählen
      </button>
      <button onClick={onShowHistory} type="button">
        Historie öffnen
      </button>
    </section>
  ),
}));
vi.mock("./ScenarioEditor", () => ({
  ScenarioEditor: ({
    config,
    onApply,
    onChange,
    onClose,
    open,
  }: {
    config: SimulationConfig;
    onApply: () => void;
    onChange: (config: SimulationConfig) => void;
    onClose: () => void;
    open: boolean;
  }) =>
    open ? (
      <section aria-label="Szenarioeditor">
        <button onClick={() => onChange({ ...config, seed: config.seed + 1 })} type="button">
          Editorwert ändern
        </button>
        <button onClick={onApply} type="button">
          Editor anwenden
        </button>
        <button onClick={onClose} type="button">
          Editor schließen
        </button>
      </section>
    ) : null,
}));
vi.mock("./SimulationHistoryDialog", () => ({
  SimulationHistoryDialog: ({ onClose, open }: { onClose: () => void; open: boolean }) =>
    open ? (
      <section aria-label="Laufauswertung">
        <button onClick={onClose} type="button">
          Historie schließen
        </button>
      </section>
    ) : null,
}));
vi.mock("./SimulationFoundationDialog", () => ({
  SimulationImportDialog: ({
    activeConfig,
    onImport,
  }: {
    activeConfig: SimulationConfig;
    onImport: (result: {
      kind: "SCENARIO";
      config: SimulationConfig;
      format: "rundflug-simulation-scenario";
      sourceName: string;
    }) => void;
  }) => (
    <section aria-label="Importieren">
      <button
        onClick={() =>
          onImport({
            kind: "SCENARIO",
            config: activeConfig,
            format: "rundflug-simulation-scenario",
            sourceName: "Importiertes Szenario",
          })
        }
        type="button"
      >
        Szenario übernehmen
      </button>
    </section>
  ),
}));
vi.mock("./simulation-fids-channel", () => ({
  useSimulationFidsPublisher: () => ({
    fidsHref: "/simulation/fids?source=synthetic-source",
    sourceId: "synthetic-source",
  }),
}));

beforeEach(() => {
  mocks.workers.length = 0;
  vi.stubGlobal("Worker", MockWorker);
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "synthetic-uuid") });
  URL.createObjectURL = vi.fn(() => "blob:synthetic-export");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("forecast simulation view", () => {
  it("shows one read-only scenario and replaces it through the import flow", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);

    expect(document.title).toBe("Prognose-Simulation · Rundflug-Leitstand");
    expect(screen.getByText("Nur Simulation – keine Tickets oder Ist-Zustände")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Aktuelles Szenario" })).toBeTruthy();
    expect(screen.getByText("Normalbetrieb")).toBeTruthy();
    expect(screen.getByText("Nicht gespeichert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Szenarioübersicht" })).toBeTruthy();
    expect(screen.getByText("Letztes Boardingfenster getroffen")).toBeTruthy();
    expect(screen.getByText("Erstprognose Boarding")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Szenario konfigurieren" }).textContent).toContain(
      "Konfigurieren",
    );
    expect(screen.queryByLabelText("Variante")).toBeNull();
    expect(screen.queryByLabelText("Variantenname")).toBeNull();
    expect(screen.queryByRole("button", { name: /duplizieren|löschen/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ein Flugzeug hinzufügen|entfernen/ })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "Seed" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Importieren …" }));
    await user.click(screen.getByRole("button", { name: "Szenario übernehmen" }));

    expect(screen.getByText("Importiertes Szenario")).toBeTruthy();
    expect(document.querySelector(".sim-import-message")?.textContent).toContain(
      "Importiertes Szenario als aktuelles Szenario geladen.",
    );
  }, 30_000);

  it("opens operational tools and keeps their close paths usable", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);

    const fidsLink = screen.getByRole("link", { name: /FIDS in neuem Tab öffnen/ });
    expect(fidsLink.getAttribute("href")).toBe("/simulation/fids?source=synthetic-source");
    expect(fidsLink.getAttribute("target")).toBe("_blank");
    expect(fidsLink.getAttribute("rel")).toBe("noopener");

    await user.click(screen.getByRole("button", { name: /Szenario konfigurieren/ }));
    expect(screen.getByRole("region", { name: "Szenarioeditor" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Editor schließen" }));
    expect(screen.queryByRole("region", { name: "Szenarioeditor" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Historie öffnen" }));
    expect(screen.getByRole("region", { name: "Laufauswertung" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Historie schließen" }));
    expect(screen.queryByRole("region", { name: "Laufauswertung" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Kennzahlen im Detail" }));
    expect(screen.getByRole("dialog", { name: "Prognosegüte im Detail" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("dialog", { name: "Prognosegüte im Detail" })).toBeNull();
  });

  it("reports comparison progress and presents a completed result", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);
    const worker = mocks.workers[0];
    expect(worker).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Baseline und Kandidat vergleichen" }));
    expect(worker?.postMessage).toHaveBeenCalledOnce();

    worker?.onmessage?.(
      new MessageEvent("message", {
        data: { type: "progress", completedRuns: 2, totalRuns: 5 },
      }),
    );
    expect(await screen.findByText("Seed-Lauf 2 von 5")).toBeTruthy();

    worker?.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "result",
          result: {
            runCount: 5,
            seedStart: 17,
            rows: [
              {
                id: "boarding-median",
                category: "Boarding",
                label: "Median absolut",
                unit: "Min.",
                baseline: 4,
                candidate: 3,
                delta: -1,
              },
            ],
          },
        },
      }),
    );

    expect(await screen.findByText("Median absolut")).toBeTruthy();
    expect(screen.getByText(/Median je Kennzahl über 5 Läufe ab Seed 17/)).toBeTruthy();
  });

  it("exports the current scenario and result packages entirely in the browser", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);

    await user.click(screen.getByRole("button", { name: "Szenario exportieren" }));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-export");
    expect(document.querySelector(".sim-import-message")?.textContent).toContain(
      "Normalbetrieb als Szenario-Konfiguration exportiert.",
    );

    await user.click(screen.getByRole("button", { name: /Ergebnis exportieren/ }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2);
  });

  it("applies playback controls and injects only synthetic operational incidents", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);

    await user.selectOptions(screen.getByLabelText("Simulationsgeschwindigkeit"), "60");
    for (let index = 0; index < 12; index += 1) {
      await user.click(screen.getByRole("button", { name: "+5 Min." }));
    }

    for (const action of ["Tanken", "Defekt", "Flugzeugausfall", "Betrieb unterbrechen"]) {
      const button = screen.getByRole("button", { name: action });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      await user.click(button);
    }
    const pauseButtons = screen.getAllByRole("button", { name: "Pause" });
    expect(pauseButtons).toHaveLength(2);
    await user.click(pauseButtons[1] as HTMLButtonElement);
    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(pauseButtons[0] as HTMLButtonElement);
    await user.click(screen.getByRole("button", { name: /Neu starten/ }));
  });

  it("applies an edited scenario without replacing the standalone FIDS link", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);

    await user.click(screen.getByRole("button", { name: /Szenario konfigurieren/ }));
    await user.click(screen.getByRole("button", { name: "Editorwert ändern" }));
    await user.click(screen.getByRole("button", { name: "Editor anwenden" }));
    expect(screen.queryByRole("region", { name: "Szenarioeditor" })).toBeNull();
    expect(screen.getByText("20260723")).toBeTruthy();

    expect(screen.getByRole("link", { name: /FIDS in neuem Tab öffnen/ })).toBeTruthy();
  });

  it("contains comparison worker failures and allows a clean retry", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);
    const firstWorker = mocks.workers[0];

    await user.click(screen.getByRole("button", { name: "Baseline und Kandidat vergleichen" }));
    firstWorker?.onmessage?.(
      new MessageEvent("message", {
        data: { type: "error", message: "Synthetischer Vergleichsfehler" },
      }),
    );
    expect(await screen.findByText("Synthetischer Vergleichsfehler")).toBeTruthy();
    expect(firstWorker?.terminate).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Erneut ausführen" }));
    const retryWorker = mocks.workers[1];
    expect(retryWorker?.postMessage).toHaveBeenCalledOnce();
    retryWorker?.onerror?.(new Event("error"));
    expect(await screen.findByText("Der lokale A/B-Vergleich ist fehlgeschlagen.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Erneut ausführen" }));
    await user.click(screen.getByRole("button", { name: "Vergleich abbrechen" }));
    expect(mocks.workers[2]?.terminate).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("dialog", { name: "A/B-Prognosevergleich" })).toBeNull();
  });
});
