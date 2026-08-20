// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSimulation } from "./engine";
import { simulationConfigForPreset } from "./model";
import { SimulationSeedBatchDialog } from "./SimulationSeedBatchDialog";
import { runSeedBatchWithRunner } from "./seed-batch";

const config = simulationConfigForPreset("NORMAL");
const baseMetrics = runSimulation(config).metrics;
const result = runSeedBatchWithRunner(config, [], 5, undefined, (runConfig) => ({
  metrics: {
    ...baseMetrics,
    initialBoarding: {
      ...baseMetrics.initialBoarding,
      p90AbsoluteErrorMinutes: runConfig.seed === config.seed ? null : runConfig.seed % 9,
    },
    operations: {
      ...baseMetrics.operations,
      completedRotations: runConfig.seed % 20,
      overtimeMinutes: runConfig.seed % 4,
      aircraftUtilizationPercent: 70 + (runConfig.seed % 5),
    },
    dispatch: {
      ...baseMetrics.dispatch,
      passengersPerHour: 30 + (runConfig.seed % 10),
      p90PassengerWaitMinutes: 40 + (runConfig.seed % 8),
    },
  },
}));

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof SimulationSeedBatchDialog>[0]> = {}) {
  const props = {
    defaultRunCount: 20,
    error: null,
    onCancel: vi.fn(),
    onClose: vi.fn(),
    onExport: vi.fn(),
    onStart: vi.fn(),
    open: true,
    progress: { completed: 0, total: 0 },
    result: null,
    running: false,
    seedStart: config.seed,
    ...overrides,
  };
  return { props, ...render(<SimulationSeedBatchDialog {...props} />) };
}

describe("SimulationSeedBatchDialog", () => {
  it("validates boundary counts and reports running, error, and retry states", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderDialog();
    const count = screen.getByRole("spinbutton", { name: "Anzahl Läufe" });
    await user.clear(count);
    await user.type(count, "4");
    expect(screen.getByRole("alert").textContent).toContain("5 bis 100");
    expect(
      (screen.getByRole("button", { name: "Mehrfachlauf starten" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.clear(count);
    await user.type(count, "100");
    await user.click(screen.getByRole("button", { name: "Mehrfachlauf starten" }));
    expect(props.onStart).toHaveBeenCalledWith(100);

    rerender(
      <SimulationSeedBatchDialog {...props} progress={{ completed: 3, total: 5 }} running />,
    );
    expect(screen.getByText("Lauf 3 von 5")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(props.onCancel).toHaveBeenCalledOnce();

    rerender(<SimulationSeedBatchDialog {...props} error="Synthetischer Fehler" result={result} />);
    expect(screen.getByRole("alert").textContent).toContain("Synthetischer Fehler");
    expect(screen.getByRole("button", { name: "Erneut berechnen" })).toBeTruthy();
  });

  it("switches tabs and metrics, sorts individual runs, exports ZIP, and shows nulls as dashes", async () => {
    const user = userEvent.setup();
    const { props } = renderDialog({ result });
    expect(screen.getByRole("tab", { name: "Betrieb" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Seed-Verteilung Betrieb")).toBeTruthy();
    await user.selectOptions(
      screen.getByLabelText("Seed-Verteilung Betrieb: Kennzahl"),
      "overtimeMinutes",
    );
    expect(screen.getByRole("img", { name: /Überzeit, Verteilung/ })).toBeTruthy();

    const operationTable = screen.getByRole("table");
    await user.click(within(operationTable).getByRole("button", { name: /Seed sortieren/ }));
    const operationSeeds = within(operationTable)
      .getAllByRole("rowheader")
      .map((cell) => Number(cell.textContent));
    expect(operationSeeds).toEqual([...operationSeeds].sort((left, right) => right - left));

    await user.click(screen.getByRole("tab", { name: "Prognose" }));
    expect(screen.getByText("Genauigkeit nach Seed")).toBeTruthy();
    expect(screen.getByText("Stabilität nach Seed")).toBeTruthy();
    await user.selectOptions(
      screen.getByLabelText("Stabilität nach Seed: Kennzahl"),
      "jumpsOver30Minutes",
    );
    expect(screen.getByRole("img", { name: /Sprünge über 30 Minuten/ })).toBeTruthy();
    expect(screen.getAllByText("–").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /ZIP exportieren/ }));
    expect(props.onExport).toHaveBeenCalledOnce();
    await user.keyboard("{Tab}");
    expect(document.activeElement).not.toBe(document.body);
  }, 20_000);
});
