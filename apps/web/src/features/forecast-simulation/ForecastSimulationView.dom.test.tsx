// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForecastSimulationView } from "./ForecastSimulationView";
import type { SimulationConfig } from "./model";

const mocks = vi.hoisted(() => ({
  fidsOpen: vi.fn(),
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
  ScenarioEditor: ({ onClose, open }: { onClose: () => void; open: boolean }) =>
    open ? (
      <section aria-label="Szenarioeditor">
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
vi.mock("./SimulationFoundationDialog", async () => {
  const actual = await vi.importActual<typeof import("./SimulationFoundationDialog")>(
    "./SimulationFoundationDialog",
  );
  return {
    nextSimulationVariantName: actual.nextSimulationVariantName,
    SimulationFoundationDialog: ({
      activeConfig,
      onLoad,
    }: {
      activeConfig: unknown;
      onLoad: (foundation: {
        config: unknown;
        format: "rundflug-simulation-scenario";
        sourceName: string;
      }) => void;
    }) => (
      <section aria-label="Simulationsgrundlage">
        <button
          onClick={() =>
            onLoad({
              config: activeConfig,
              format: "rundflug-simulation-scenario",
              sourceName: "Importierte Variante",
            })
          }
          type="button"
        >
          Grundlage übernehmen
        </button>
      </section>
    ),
  };
});
vi.mock("./SimulationFidsPopout", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    SimulationFidsPopout: forwardRef(function MockFidsPopout(_props, ref) {
      useImperativeHandle(ref, () => ({ open: mocks.fidsOpen }));
      return null;
    }),
  };
});

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
  it("manages variants and imports a scenario as an isolated variant", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);

    expect(screen.getByText("Nur Simulation – keine Tickets oder Ist-Zustände")).toBeTruthy();
    const variantSelect = screen.getByLabelText("Variante");
    expect(within(variantSelect).getAllByRole("option")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /Duplizieren/ }));
    expect(within(variantSelect).getAllByRole("option")).toHaveLength(2);
    expect((screen.getByLabelText("Variantenname") as HTMLInputElement).value).toBe(
      "Variante 1 – Kopie",
    );

    await user.click(screen.getByRole("button", { name: /Löschen/ }));
    expect(within(variantSelect).getAllByRole("option")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /Simulationsgrundlage laden/ }));
    await user.click(screen.getByRole("button", { name: "Grundlage übernehmen" }));

    expect(within(variantSelect).getAllByRole("option")).toHaveLength(2);
    expect(document.querySelector(".sim-import-message")?.textContent).toContain(
      "Importierte Variante als neue Variante geladen.",
    );
  }, 30_000);

  it("opens operational tools and keeps their close paths usable", async () => {
    const user = userEvent.setup();
    render(<ForecastSimulationView />);

    await user.click(screen.getByRole("button", { name: /FIDS öffnen/ }));
    expect(mocks.fidsOpen).toHaveBeenCalledOnce();

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

    await waitFor(() => expect(screen.getByText("Median absolut")).toBeTruthy());
    expect(screen.getByText(/Median je Kennzahl über 5 Läufe ab Seed 17/)).toBeTruthy();
  });

  it("calibrates a CSV and exposes invalid input without changing the operating system", async () => {
    render(<ForecastSimulationView />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    const rows = Array.from({ length: 6 }, (_, index) => {
      const hour = String(8 + index).padStart(2, "0");
      return `2026-07-22T${hour}:00:00.000Z,2026-07-22T${hour}:07:00.000Z,2026-07-22T${hour}:27:00.000Z,2026-07-22T${hour}:33:00.000Z,false`;
    });
    const validFile = {
      text: async () =>
        ["called_at,departed_at,landed_at,completed_at,interrupted", ...rows].join("\n"),
    } as File;
    fireEvent.change(input as HTMLInputElement, { target: { files: [validFile] } });
    await waitFor(() =>
      expect(document.querySelector(".sim-import-message")?.textContent).toMatch(
        /Umläufe kalibriert/,
      ),
    );

    const invalidFile = { text: async () => "invalid" } as File;
    fireEvent.change(input as HTMLInputElement, { target: { files: [invalidFile] } });
    await waitFor(() =>
      expect(document.querySelector(".sim-import-message")?.textContent).toMatch(
        /CSV|Spalten|Datensätze/,
      ),
    );
  });
});
