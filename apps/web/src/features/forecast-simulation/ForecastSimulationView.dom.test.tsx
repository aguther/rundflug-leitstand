// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSimulation } from "./engine";
import { ForecastSimulationView } from "./ForecastSimulationView";
import type { SimulationConfig } from "./model";

const mocks = vi.hoisted(() => ({
  fidsInputs: [] as Array<{ clockMs: number; running: boolean; speed: number; visibleAt: number }>,
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
    result,
  }: {
    onSelectRotation: (rotationId: string) => void;
    result: { rotations: Array<{ id: string }> };
  }) => (
    <section aria-label="Simulationsverlauf">
      <button onClick={() => onSelectRotation(result.rotations[0]?.id ?? "")} type="button">
        Ersten Umlauf auswählen
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
  useSimulationFidsPublisher: (input: {
    clockMs: number;
    running: boolean;
    speed: number;
    visibleAt: number;
  }) => {
    mocks.fidsInputs.push(input);
    return {
      fidsHref: "/simulation/fids?source=synthetic-source",
      sourceId: "synthetic-source",
    };
  },
}));

beforeEach(() => {
  mocks.workers.length = 0;
  mocks.fidsInputs.length = 0;
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
    expect(screen.getByText("Letzter Boarding-Prognosefehler vor Ist")).toBeTruthy();
    expect(screen.getByText("Erste Boardingprognose vs. Ist im Tagesverlauf")).toBeTruthy();
    expect(screen.queryByText("Synthetischer Lauf")).toBeNull();
    expect(screen.queryByText(/Je Fluggruppe ·/)).toBeNull();
    expect(screen.queryByText(/Mausrad\/Ziehen/)).toBeNull();
    expect(
      screen.getAllByText("Noch nicht genügend abgeschlossene Prognosevergleiche."),
    ).toHaveLength(2);
    expect(document.querySelector(".sim-metric-card-source")).toBeNull();
    expect(document.querySelectorAll(".sim-metric-card")).toHaveLength(5);
    expect(screen.getByText(/Fluggruppen · letzter Snapshot/)).toBeTruthy();
    expect(screen.getByText(/Fluggruppen · Median absolut/)).toBeTruthy();
    const analysisNavigation = screen.getByRole("navigation", { name: "Simulationsauswertung" });
    expect(analysisNavigation.closest("aside")).not.toBeNull();
    expect(document.querySelector(".sim-export-row")).toBeNull();
    expect(screen.getByRole("button", { name: "Szenario konfigurieren" }).textContent).toContain(
      "Konfigurieren",
    );
    expect(screen.queryByLabelText("Variante")).toBeNull();
    expect(screen.queryByLabelText("Variantenname")).toBeNull();
    expect(screen.queryByRole("button", { name: /duplizieren|löschen/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ein Flugzeug hinzufügen|entfernen/ })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "Seed" })).toBeNull();
    expect(
      screen.getAllByRole("heading", {
        name: /^(Szenario|Bearbeiten & Dateien|Läufe|Auswertung)$/,
      }),
    ).toHaveLength(4);
    const sidebarActions = [
      ...document.querySelectorAll<HTMLButtonElement>(".sim-sidebar .ds-button"),
    ];
    expect(sidebarActions.map((button) => button.textContent?.trim().replace(/\s+/g, " "))).toEqual(
      [
        "Konfigurieren",
        "Importieren …",
        "Szenario exportieren",
        "Mehrfachlauf",
        "A/B-Vergleich",
        "Kennzahlen im Detail",
        "Lauf auswerten",
        "Ergebnis exportieren",
      ],
    );
    expect(sidebarActions.every((button) => button.querySelector("svg") !== null)).toBe(true);

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
    expect(await screen.findByRole("region", { name: "Szenarioeditor" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Editor schließen" }));
    expect(screen.queryByRole("region", { name: "Szenarioeditor" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Ersten Umlauf auswählen" }));
    await user.click(screen.getByRole("button", { name: "Lauf auswerten" }));
    expect(screen.getByRole("region", { name: "Laufauswertung" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Historie schließen" }));
    expect(screen.queryByRole("region", { name: "Laufauswertung" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Kennzahlen im Detail" }));
    expect(screen.getByRole("dialog", { name: "Prognosegüte im Detail" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Prognosestabilität" })).toBeTruthy();
    expect(
      await screen.findByRole("img", {
        name: "Histogramm der absoluten Boarding-Prognoseänderungen",
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("dialog", { name: "Prognosegüte im Detail" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Mehrfachlauf" }));
    expect(await screen.findByRole("dialog", { name: "Mehrfachlauf vergleichen" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Anzahl Läufe" })).toBeTruthy();
    expect((screen.getByLabelText("Start-Seed") as HTMLInputElement).readOnly).toBe(true);
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("dialog", { name: "Mehrfachlauf vergleichen" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "A/B-Vergleich" }));
    expect(await screen.findByRole("dialog", { name: "A/B-Prognosevergleich" })).toBeTruthy();
    expect(screen.getByLabelText("Anzahl Vergleichsläufe")).toBeTruthy();
    expect(screen.getByLabelText("Start-Seed des Vergleichs")).toBeTruthy();
    expect(mocks.workers[0]?.postMessage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("dialog", { name: "A/B-Prognosevergleich" })).toBeNull();
  });

  it("renders adaptive time ticks and symmetric minute scales in both error charts", () => {
    const { container } = render(<ForecastSimulationView />);
    fireEvent.click(screen.getByRole("button", { name: "Bis Ende berechnen" }));

    const charts = container.querySelectorAll(".sim-error-chart");
    expect(charts).toHaveLength(2);
    for (const chart of charts) {
      const yLabels = [...chart.querySelectorAll(".sim-chart-axis-label")].map(
        (label) => label.textContent,
      );
      expect(yLabels[0]).toMatch(/^\+\d+ Min\.$/);
      expect(yLabels[1]).toBe("0");
      expect(yLabels[2]).toMatch(/^−\d+ Min\.$/);
      expect(chart.querySelectorAll(".sim-chart-x-tick text").length).toBeGreaterThan(2);
    }
  }, 15_000);

  it("reports comparison progress and presents a completed result", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);
    const worker = mocks.workers[0];
    expect(worker).toBeDefined();

    await user.click(screen.getByRole("button", { name: "A/B-Vergleich" }));
    expect(worker?.postMessage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "A/B-Vergleich starten" }));
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

    const playbackToggle = screen.getByRole("button", { name: "Start" });
    expect(playbackToggle.getAttribute("aria-pressed")).toBe("false");
    await user.click(playbackToggle);
    expect(playbackToggle.textContent).toContain("Pause");
    expect(playbackToggle.getAttribute("aria-pressed")).toBe("true");
    await user.click(playbackToggle);
    expect(playbackToggle.textContent).toContain("Start");
    expect(playbackToggle.getAttribute("aria-pressed")).toBe("false");

    const speedSelect = screen.getByLabelText("Simulationsgeschwindigkeit");
    expect([...speedSelect.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "1",
      "2",
      "5",
      "10",
      "30",
      "60",
      "120",
      "300",
      "600",
    ]);
    await user.selectOptions(speedSelect, "600");
    for (let index = 0; index < 12; index += 1) {
      await user.click(screen.getByRole("button", { name: "+5 Min." }));
    }

    for (const action of ["Pause", "Tanken", "Defekt", "Flugzeugausfall", "Betrieb unterbrechen"]) {
      const button = screen.getByRole("button", { name: action });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      await user.click(button);
    }
    await user.click(playbackToggle);
    await user.click(playbackToggle);
    const calculateToEnd = screen.getByRole("button", { name: "Bis Ende berechnen" });
    await user.click(calculateToEnd);
    expect((calculateToEnd as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Beendet" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "+5 Min." }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(mocks.fidsInputs.at(-1)).toEqual(
      expect.objectContaining({ running: false, speed: 600 }),
    );
    expect(mocks.fidsInputs.at(-1)?.clockMs).toBe(mocks.fidsInputs.at(-1)?.visibleAt);
    fireEvent.click(screen.getByRole("button", { name: "Neu starten" }));
    const resetButton = screen.getByRole("button", { name: "Simulation wird neu gestartet" });
    expect(resetButton.getAttribute("aria-busy")).toBe("true");
    expect((playbackToggle as HTMLButtonElement).disabled).toBe(true);
    expect((calculateToEnd as HTMLButtonElement).disabled).toBe(true);
    expect((speedSelect as HTMLSelectElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Mehrfachlauf" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText("Ereignis für") as HTMLSelectElement).disabled).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Simulation wird neu gestartet" })).toBeNull(),
    );
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((calculateToEnd as HTMLButtonElement).disabled).toBe(false);
    expect(vi.mocked(runSimulation)).toHaveBeenLastCalledWith(expect.anything(), []);
  });

  it("applies an edited scenario without replacing the standalone FIDS link", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);

    await user.click(screen.getByRole("button", { name: /Szenario konfigurieren/ }));
    await user.click(await screen.findByRole("button", { name: "Editorwert ändern" }));
    await user.click(screen.getByRole("button", { name: "Editor anwenden" }));
    expect(screen.queryByRole("region", { name: "Szenarioeditor" })).toBeNull();
    expect(screen.getByText("20260723")).toBeTruthy();

    expect(screen.getByRole("link", { name: /FIDS in neuem Tab öffnen/ })).toBeTruthy();
  });

  it("contains comparison worker failures and allows a clean retry", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);
    const firstWorker = mocks.workers[0];

    await user.click(screen.getByRole("button", { name: "A/B-Vergleich" }));
    expect(firstWorker?.postMessage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "A/B-Vergleich starten" }));
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
