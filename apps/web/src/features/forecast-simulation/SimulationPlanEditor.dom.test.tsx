// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { SimulationConfig, SimulationRotation } from "./model";
import { simulationConfigForPreset } from "./model";
import { SimulationPlanEditor } from "./SimulationPlanEditor";

afterEach(cleanup);

const rotations = [
  { id: "rotation-a", communicationNumber: 7, productCode: "PA" },
] as SimulationRotation[];

function operationalConfig(): SimulationConfig {
  const config = simulationConfigForPreset("NORMAL");
  config.operationalModel = {
    sourceName: "Synthetic operations",
    gates: [{ id: "gate-a", label: "Gate A" }],
    resourceGroups: [
      {
        id: "group-a",
        name: "Panorama",
        shortCode: "PA",
        gateId: "gate-a",
        automaticPrecallEnabled: true,
      },
    ],
    aircraft: [
      {
        id: "aircraft-a",
        registration: "D-ESYN",
        aircraftType: "C172",
        capacity: 4,
        resourceGroupId: "group-a",
      },
    ],
    pilots: [{ id: "pilot-a", operationalCode: "P-01", active: true }],
    products: [
      {
        id: "product-a",
        name: "Panorama",
        code: "PA",
        resourceGroupId: "group-a",
        gateId: "gate-a",
        referenceCapacity: 4,
        referenceDurationMinutes: 20,
      },
    ],
  };
  return config;
}

function PlanHarness() {
  const [config, setConfig] = useState(operationalConfig);
  return <SimulationPlanEditor config={config} onChange={setConfig} rotations={rotations} />;
}

describe("simulation plan editor", () => {
  it("explains why plan entries are unavailable without operational master data", () => {
    render(
      <SimulationPlanEditor
        config={simulationConfigForPreset("NORMAL")}
        onChange={() => undefined}
        rotations={[]}
      />,
    );

    expect(screen.getByText(/Planeinträge stehen zur Verfügung/)).toBeTruthy();
  });

  it("creates, scopes and removes a planned interruption", async () => {
    const user = userEvent.setup();
    render(<PlanHarness />);

    expect(screen.getByText("Noch keine Planeinträge vorhanden.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Planeintrag hinzufügen/ }));
    expect(screen.getByText("sim-plan-001")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Art"), "WEATHER");
    await user.selectOptions(screen.getByLabelText("Geltungsbereich"), "AIRCRAFT");
    expect((screen.getByLabelText("Ziel") as HTMLSelectElement).value).toBe("aircraft-a");
    await user.selectOptions(screen.getByLabelText("Auswirkung"), "SLOWDOWN");
    const factor = screen.getByLabelText("Verzögerungsfaktor (%)") as HTMLInputElement;
    expect(factor.value).toBe("150");
    await user.clear(factor);
    await user.type(factor, "175");

    await user.selectOptions(screen.getByLabelText("Beginn"), "AFTER_CURRENT_ROTATION");
    expect((screen.getByLabelText("Bezugsumlauf") as HTMLSelectElement).value).toBe("rotation-a");

    await user.click(screen.getByRole("button", { name: "sim-plan-001 entfernen" }));
    expect(screen.queryByText("sim-plan-001")).toBeNull();
  });

  it("edits time windows, duration and an event-level public note", async () => {
    const user = userEvent.setup();
    render(<PlanHarness />);
    await user.click(screen.getByRole("button", { name: /Planeintrag hinzufügen/ }));

    const minimum = screen.getByLabelText(
      "sim-plan-001 minimumDurationMinutes",
    ) as HTMLInputElement;
    await user.clear(minimum);
    await user.type(minimum, "12");
    expect(minimum.value).toBe("12");

    const note = screen.getByLabelText("Öffentlicher Hinweis (optional)") as HTMLInputElement;
    await user.type(note, "Synthetische Wetterpause");
    expect(note.value).toBe("Synthetische Wetterpause");

    const earliest = screen.getByLabelText("Frühester Beginn") as HTMLInputElement;
    fireEvent.change(earliest, { target: { value: "2026-07-22T10:30" } });
    expect(earliest.value).toBe("2026-07-22T10:30");
  });
});
