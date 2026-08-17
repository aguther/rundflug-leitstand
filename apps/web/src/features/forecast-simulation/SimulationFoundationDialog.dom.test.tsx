// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { simulationConfigForPreset } from "./model";
import { SimulationImportDialog } from "./SimulationFoundationDialog";
import { createSimulationScenarioTemplate } from "./simulation-scenario-template";

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:synthetic-scenario");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog() {
  const activeConfig = simulationConfigForPreset("NORMAL");
  const onClose = vi.fn();
  const onImport = vi.fn();
  render(
    <SimulationImportDialog activeConfig={activeConfig} onClose={onClose} onImport={onImport} />,
  );
  return { activeConfig, onClose, onImport };
}

function jsonFile(name: string, content: unknown): File {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return { name, size: text.length, text: async () => text } as File;
}

describe("simulation import dialog", () => {
  it("loads a selected built-in scenario as the current scenario", async () => {
    const user = userEvent.setup();
    const { onImport } = renderDialog();

    await user.click(screen.getByText("Flugzeugausfall"));
    await user.click(screen.getByRole("button", { name: "Szenario laden" }));

    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "SCENARIO",
        format: "rundflug-simulation-scenario",
        sourceName: "Flugzeugausfall",
        config: expect.objectContaining({ preset: "AIRCRAFT_FAILURE" }),
      }),
    );
  });

  it("downloads the selected scenario without loading it", async () => {
    const user = userEvent.setup();
    const { onImport } = renderDialog();

    await user.click(screen.getByRole("button", { name: /Vorlage als JSON herunterladen/ }));

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-scenario");
    expect(onImport).not.toHaveBeenCalled();
  });

  it("previews and imports a valid scenario JSON", async () => {
    const user = userEvent.setup();
    const { activeConfig, onImport } = renderDialog();
    const template = createSimulationScenarioTemplate(
      "Synthetische Importvariante",
      activeConfig,
      "2026-08-12T12:00:00.000Z",
    );

    await user.click(screen.getByRole("tab", { name: "Simulationsdatei (JSON)" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [jsonFile("synthetic-scenario.json", template)] },
    });
    await user.click(screen.getByRole("button", { name: "Datei prüfen" }));

    expect(await screen.findByText("Synthetische Importvariante")).toBeTruthy();
    expect(screen.getByText("rundflug-simulation-scenario")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Szenario laden" }));
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "SCENARIO",
        format: "rundflug-simulation-scenario",
        sourceName: "Synthetische Importvariante",
      }),
    );
  });

  it("reports invalid JSON and preserves keyboard tab navigation", async () => {
    const user = userEvent.setup();
    renderDialog();
    const scenarioTab = screen.getByRole("tab", { name: "Szenario" });
    const jsonTab = screen.getByRole("tab", { name: "Simulationsdatei (JSON)" });
    const csvTab = screen.getByRole("tab", { name: "Kalibrierung (CSV)" });

    scenarioTab.focus();
    fireEvent.keyDown(scenarioTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(jsonTab);

    fireEvent.keyDown(jsonTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(csvTab);
    fireEvent.keyDown(csvTab, { key: "Home" });
    expect(document.activeElement).toBe(scenarioTab);
    await user.click(jsonTab);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [jsonFile("invalid.json", "{invalid-json")] },
    });
    await user.click(screen.getByRole("button", { name: "Datei prüfen" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Szenario laden")).toBeNull();
    fireEvent.keyDown(jsonTab, { key: "Home" });
    expect(document.activeElement).toBe(scenarioTab);
  });

  it("calibrates the current scenario from CSV and keeps invalid input in the dialog", async () => {
    const user = userEvent.setup();
    const { onImport } = renderDialog();

    await user.click(screen.getByRole("tab", { name: "Kalibrierung (CSV)" }));
    const input = document.querySelector<HTMLInputElement>('input[accept=".csv,text/csv"]');
    const rows = Array.from({ length: 6 }, (_, index) => {
      const hour = String(8 + index).padStart(2, "0");
      return `2026-07-22T${hour}:00:00.000Z,2026-07-22T${hour}:07:00.000Z,2026-07-22T${hour}:27:00.000Z,2026-07-22T${hour}:33:00.000Z,false`;
    });
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [
          jsonFile(
            "calibration.csv",
            ["called_at,departed_at,landed_at,completed_at,interrupted", ...rows].join("\n"),
          ),
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: "Kalibrierung anwenden" }));

    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "CALIBRATION", validRows: 6, excludedRows: 0 }),
    );

    onImport.mockClear();
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [jsonFile("invalid.csv", "invalid")] },
    });
    await user.click(screen.getByRole("button", { name: "Kalibrierung anwenden" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("rejects CSV files above the two MiB limit before reading them", async () => {
    const user = userEvent.setup();
    const { onImport } = renderDialog();
    const text = vi.fn(async () => "invalid");

    await user.click(screen.getByRole("tab", { name: "Kalibrierung (CSV)" }));
    const input = document.querySelector<HTMLInputElement>('input[accept=".csv,text/csv"]');
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [
          {
            name: "oversized.csv",
            size: 2 * 1024 * 1024 + 1,
            text,
          } as unknown as File,
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: "Kalibrierung anwenden" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Die CSV-Datei ist größer als 2 MiB.",
    );
    expect(text).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });
});
