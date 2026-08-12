// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { SimulationConfig } from "./model";
import { simulationConfigForPreset } from "./model";
import { SimulationRecurringRulesEditor } from "./SimulationRecurringRulesEditor";

afterEach(cleanup);

function operationalConfig(): SimulationConfig {
  const config = simulationConfigForPreset("NORMAL");
  config.operationalModel = {
    sourceName: "Synthetic operations",
    gates: [],
    resourceGroups: [],
    aircraft: [
      {
        id: "aircraft-a",
        registration: "D-ESYN",
        aircraftType: "C172",
        capacity: 4,
        resourceGroupId: "group-a",
        refuelReminderThreshold: 6,
      },
    ],
    pilots: [
      { id: "pilot-a", operationalCode: "P-01", active: true },
      { id: "pilot-b", operationalCode: "P-02", active: true },
    ],
    products: [],
  };
  return config;
}

function RulesHarness({
  initialConfig = operationalConfig(),
}: {
  initialConfig?: SimulationConfig;
}) {
  const [config, setConfig] = useState(initialConfig);
  return <SimulationRecurringRulesEditor config={config} onChange={setConfig} />;
}

describe("simulation recurring rules editor", () => {
  it("stays hidden without an operational model", () => {
    const { container } = render(
      <SimulationRecurringRulesEditor
        config={simulationConfigForPreset("NORMAL")}
        onChange={() => undefined}
      />,
    );

    expect(container.childElementCount).toBe(0);
  });

  it("creates an aircraft rule with deterministic defaults and removes it", async () => {
    const user = userEvent.setup();
    render(<RulesHarness />);

    expect(screen.getByText("Noch keine zielbezogene Regel vorhanden.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Regel hinzufügen/ }));

    expect((screen.getByLabelText("Art") as HTMLSelectElement).value).toBe("REFUELING");
    expect(screen.getByText("voraussichtlich in 6 Umläufen")).toBeTruthy();
    expect((screen.getByLabelText("Zielart") as HTMLSelectElement).value).toBe("AIRCRAFT");
    expect((screen.getByLabelText("Ziel") as HTMLSelectElement).value).toBe("aircraft-a");

    await user.click(screen.getByRole("button", { name: "sim-rule-1 löschen" }));
    expect(screen.queryByRole("button", { name: "sim-rule-1 löschen" })).toBeNull();
  });

  it("changes scope, progress, trigger and duration while preserving the rule", async () => {
    const user = userEvent.setup();
    render(<RulesHarness />);
    await user.click(screen.getByRole("button", { name: /Regel hinzufügen/ }));

    await user.selectOptions(screen.getByLabelText("Zielart"), "PILOT");
    expect((screen.getByLabelText("Art") as HTMLSelectElement).value).toBe("PAUSE");
    await user.selectOptions(screen.getByLabelText("Ziel"), "pilot-b");
    await user.selectOptions(screen.getByLabelText("Auslöser"), "OPERATING_MINUTES");

    const interval = screen.getByLabelText("Intervall") as HTMLInputElement;
    await user.clear(interval);
    await user.type(interval, "25");
    const progress = screen.getByLabelText("Bestätigter Fortschritt") as HTMLInputElement;
    await user.clear(progress);
    await user.type(progress, "5");
    expect(screen.getByText("voraussichtlich in 20 Betriebsminuten")).toBeTruthy();

    const typicalDuration = screen.getByLabelText(
      "sim-rule-1 typicalDurationMinutes",
    ) as HTMLInputElement;
    await user.clear(typicalDuration);
    await user.type(typicalDuration, "24");
    expect(typicalDuration.value).toBe("24");
    expect((screen.getByLabelText("Ziel") as HTMLSelectElement).value).toBe("pilot-b");
  });

  it("uses pilot defaults when no aircraft is available and avoids duplicate generated keys", async () => {
    const config = operationalConfig();
    if (!config.operationalModel) throw new Error("Expected operational model fixture");
    config.operationalModel.aircraft = [];
    config.recurringRules = [
      {
        key: "sim-rule-2",
        scopeType: "PILOT",
        scopeId: "pilot-a",
        kind: "PAUSE",
        triggerMetric: "OPERATING_MINUTES",
        intervalValue: 10,
        progressValue: 10,
        minimumDurationMinutes: 15,
        typicalDurationMinutes: 20,
        maximumDurationMinutes: 30,
      },
    ];
    const user = userEvent.setup();
    render(<RulesHarness initialConfig={config} />);

    expect(screen.getByText("jetzt fällig")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Regel hinzufügen/ }));

    expect(screen.getByRole("button", { name: "sim-rule-3 löschen" })).toBeTruthy();
    expect(
      screen.getAllByLabelText("Art").map((element) => (element as HTMLSelectElement).value),
    ).toEqual(["PAUSE", "PAUSE"]);
  });
});
