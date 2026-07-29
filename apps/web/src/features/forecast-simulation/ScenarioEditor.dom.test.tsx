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
});
