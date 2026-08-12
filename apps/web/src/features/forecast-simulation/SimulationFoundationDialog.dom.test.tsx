// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { simulationConfigForPreset } from "./model";
import { SimulationFoundationDialog } from "./SimulationFoundationDialog";
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
  const onLoad = vi.fn();
  render(
    <SimulationFoundationDialog activeConfig={activeConfig} onClose={onClose} onLoad={onLoad} />,
  );
  return { activeConfig, onClose, onLoad };
}

function jsonFile(name: string, content: unknown): File {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return { name, size: text.length, text: async () => text } as File;
}

describe("simulation foundation dialog", () => {
  it("loads a selected built-in scenario as a new isolated foundation", async () => {
    const user = userEvent.setup();
    const { onLoad } = renderDialog();

    await user.click(screen.getByText("Flugzeugausfall"));
    await user.click(screen.getByRole("button", { name: "Als neue Variante laden" }));

    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "rundflug-simulation-scenario",
        sourceName: "Flugzeugausfall",
        config: expect.objectContaining({ preset: "AIRCRAFT_FAILURE" }),
      }),
    );
  });

  it("downloads the selected scenario without loading it", async () => {
    const user = userEvent.setup();
    const { onLoad } = renderDialog();

    await user.click(screen.getByRole("button", { name: /Vorlage als JSON herunterladen/ }));

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-scenario");
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("previews and imports a valid scenario JSON", async () => {
    const user = userEvent.setup();
    const { activeConfig, onLoad } = renderDialog();
    const template = createSimulationScenarioTemplate(
      "Synthetische Importvariante",
      activeConfig,
      "2026-08-12T12:00:00.000Z",
    );

    await user.click(screen.getByRole("tab", { name: "JSON-Datei" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [jsonFile("synthetic-scenario.json", template)] },
    });
    await user.click(screen.getByRole("button", { name: "Datei prüfen" }));

    expect(await screen.findByText("Synthetische Importvariante")).toBeTruthy();
    expect(screen.getByText("rundflug-simulation-scenario")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Als neue Variante laden" }));
    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "rundflug-simulation-scenario",
        sourceName: "Synthetische Importvariante",
      }),
    );
  });

  it("reports invalid JSON and preserves keyboard tab navigation", async () => {
    const user = userEvent.setup();
    renderDialog();
    const scenarioTab = screen.getByRole("tab", { name: "Szenario" });
    const jsonTab = screen.getByRole("tab", { name: "JSON-Datei" });

    scenarioTab.focus();
    fireEvent.keyDown(scenarioTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(jsonTab);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [jsonFile("invalid.json", "{invalid-json")] },
    });
    await user.click(screen.getByRole("button", { name: "Datei prüfen" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Als neue Variante laden")).toBeNull();
    fireEvent.keyDown(jsonTab, { key: "Home" });
    expect(document.activeElement).toBe(scenarioTab);
  });
});
