// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  demandForProfile,
  type SimulationConfig,
  simulationConfigForPreset,
  validateSimulationConfig,
} from "./model";
import { ScenarioEditor } from "./ScenarioEditor";

afterEach(cleanup);

function productDemandConfig(): SimulationConfig {
  const config = simulationConfigForPreset("NORMAL");
  config.operationalModel = {
    sourceName: "Produktnachfrage",
    gates: [
      { id: "gate-a", label: "Flight Line A" },
      { id: "gate-b", label: "Flight Line B" },
    ],
    resourceGroups: [
      {
        id: "group-a",
        name: "Kurze Rundflüge",
        shortCode: "KA",
        gateId: "gate-a",
        automaticPrecallEnabled: true,
      },
      {
        id: "group-b",
        name: "Lange Rundflüge",
        shortCode: "LB",
        gateId: "gate-b",
        automaticPrecallEnabled: true,
      },
    ],
    aircraft: [
      {
        id: "aircraft-a",
        registration: "D-ESYA",
        aircraftType: "Simulation",
        capacity: 4,
        resourceGroupId: "group-a",
      },
      {
        id: "aircraft-b",
        registration: "D-ESYB",
        aircraftType: "Simulation",
        capacity: 4,
        resourceGroupId: "group-b",
      },
    ],
    pilots: [{ id: "pilot-a", operationalCode: "P-01", active: true }],
    products: [
      {
        id: "product-a",
        name: "Kurzflug",
        code: "K",
        resourceGroupId: "group-a",
        gateId: "gate-a",
        referenceCapacity: 4,
        referenceDurationMinutes: 15,
      },
      {
        id: "product-b",
        name: "Langflug",
        code: "L",
        resourceGroupId: "group-b",
        gateId: "gate-b",
        referenceCapacity: 4,
        referenceDurationMinutes: 30,
      },
    ],
  };
  config.demandByProduct = {
    "product-a": demandForProfile("UNIFORM", 480, 6),
    "product-b": demandForProfile("UNIFORM", 480, 12),
  };
  return config;
}

function EditorHarness() {
  const [config, setConfig] = useState(productDemandConfig);
  return (
    <ScenarioEditor
      config={config}
      errors={validateSimulationConfig(config)}
      onApply={() => undefined}
      onChange={setConfig}
      onClose={() => undefined}
      open
      rotations={[]}
    />
  );
}

describe("product demand editor", () => {
  it("renders as a centered modal with one scrollable body and a persistent footer", () => {
    render(<EditorHarness />);

    const dialog = screen.getByRole("dialog", { name: "Szenario konfigurieren" });
    expect(dialog.classList.contains("sim-editor-dialog")).toBe(true);
    expect(screen.getByText(/Stammdaten, Tagesplan, simulierte Realität/)).toBeTruthy();

    const body = dialog.querySelector(".sim-editor-dialog-body");
    const apply = within(dialog).getByRole("button", { name: "Übernehmen & neu starten" });
    expect(body).not.toBeNull();
    expect(body?.contains(screen.getByRole("navigation", { name: "Konfigurationsbereiche" }))).toBe(
      true,
    );
    expect(body?.contains(apply)).toBe(false);
  });

  it("updates admin planning values and automatic precall switches", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);

    const boarding = screen.getByLabelText("Plan Boarding in Minuten") as HTMLInputElement;
    fireEvent.change(boarding, { target: { value: "7" } });
    expect(boarding.value).toBe("7");

    const aircraftType = screen.getByLabelText("Flugzeugtyp") as HTMLInputElement;
    await user.clear(aircraftType);
    await user.type(aircraftType, "Cessna 172");
    expect(aircraftType.value).toBe("Cessna 172");

    const eventPrecall = screen.getByLabelText(
      "Automatischen Voraufruf für Veranstaltung aktivieren",
    ) as HTMLInputElement;
    const priorChecked = eventPrecall.checked;
    await user.click(eventPrecall);
    expect(eventPrecall.checked).toBe(!priorChecked);
  });

  it("edits the selected product without changing another product", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);
    await user.click(screen.getByRole("button", { name: "Simulierte Realität" }));

    const total = screen.getByRole("region", { name: "Gesamtnachfrage" });
    expect(within(total).getByText(/Ø 18 Pers\.\/Std\./)).toBeTruthy();
    expect(screen.getByText("KA · Kurze Rundflüge")).toBeTruthy();
    expect(screen.getByText("LB · Lange Rundflüge")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Produkt L Langflug auswählen" }));
    const rate = screen.getByLabelText(
      "Nachfragefenster 1, Personen je Stunde",
    ) as HTMLInputElement;
    expect(rate.value).toBe("12");
    fireEvent.change(rate, { target: { value: "30" } });

    expect(rate.value).toBe("30");
    expect(within(total).getByText(/Ø 36 Pers\.\/Std\./)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Produkt K Kurzflug auswählen" }));
    expect(
      (screen.getByLabelText("Nachfragefenster 1, Personen je Stunde") as HTMLInputElement).value,
    ).toBe("6");
  });

  it("edits demand windows, phase distributions, incidents, and the seed", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);
    await user.click(screen.getByRole("button", { name: "Simulierte Realität" }));

    const salesStart = screen.getAllByLabelText("Von, Uhrzeit")[0] as HTMLInputElement;
    const originalStart = salesStart.value;
    fireEvent.change(salesStart, { target: { value: "invalid" } });
    fireEvent.blur(salesStart);
    expect(salesStart.value).toBe(originalStart);
    fireEvent.change(salesStart, { target: { value: "07:30" } });
    fireEvent.keyDown(salesStart, { key: "Enter" });
    expect(salesStart.value).toBe("07:30");

    const profile = screen.getByRole("combobox", { name: "Vorlage" });
    fireEvent.change(profile, { target: { value: "OPENING_RUSH" } });
    expect((profile as HTMLSelectElement).value).toBe("OPENING_RUSH");

    await user.click(screen.getByRole("button", { name: /Zeitfenster hinzufügen/ }));
    expect(screen.getAllByLabelText(/Nachfragefenster \d+, Personen je Stunde/)).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Nachfragefenster 3 entfernen" }));
    expect(screen.getAllByLabelText(/Nachfragefenster \d+, Personen je Stunde/)).toHaveLength(2);

    const boardingMinimum = screen.getByLabelText("Boarding, Minimum") as HTMLInputElement;
    fireEvent.change(boardingMinimum, { target: { value: "3" } });
    expect(boardingMinimum.value).toBe("3");

    const refueling = screen.getByLabelText("Tanken aktiv") as HTMLInputElement;
    await user.click(refueling);
    expect(refueling.checked).toBe(false);
    const defectProbability = screen.getByLabelText(
      "Wahrscheinlichkeit Tagesausfall in Prozent",
    ) as HTMLInputElement;
    fireEvent.change(defectProbability, { target: { value: "25" } });
    expect(defectProbability.value).toBe("25");

    const seed = screen.getByLabelText("Seed") as HTMLInputElement;
    fireEvent.change(seed, { target: { value: "42" } });
    expect(seed.value).toBe("42");
  });

  it("edits and resets forecast and precall laboratory profiles", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);
    await user.click(screen.getByRole("button", { name: "Prognose-Labor" }));

    expect(screen.getByText(/nur lokal/)).toBeTruthy();
    expect(screen.getAllByLabelText(/, Kandidat$/)).toHaveLength(17);
    const maximumSamples = screen.getByLabelText(
      "Maximale Lernwerte, Kandidat",
    ) as HTMLInputElement;
    fireEvent.change(maximumSamples, { target: { value: "37" } });
    expect(maximumSamples.value).toBe("37");
    await user.click(screen.getByRole("button", { name: "Maximale Lernwerte zurücksetzen" }));
    expect(maximumSamples.value).not.toBe("37");

    const leadMinutes = screen.getByLabelText(
      "Gewünschte Gate-Wartezeit, Kandidat",
    ) as HTMLInputElement;
    fireEvent.change(leadMinutes, { target: { value: "19" } });
    expect(leadMinutes.value).toBe("19");
    await user.click(
      screen.getByRole("button", { name: "Gewünschte Gate-Wartezeit zurücksetzen" }),
    );
    expect(leadMinutes.value).not.toBe("19");

    const runs = screen.getByLabelText("Anzahl A/B-Läufe") as HTMLInputElement;
    fireEvent.change(runs, { target: { value: "25" } });
    expect(runs.value).toBe("25");

    const resetAll = screen.getAllByRole("button", { name: /Alle zurücksetzen/ });
    expect(resetAll).toHaveLength(2);
    await user.click(resetAll[0] as HTMLButtonElement);
    await user.click(resetAll[1] as HTMLButtonElement);
  });
});
