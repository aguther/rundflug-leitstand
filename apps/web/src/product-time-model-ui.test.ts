import { describe, expect, it } from "vitest";
import adminViewSource from "./admin-view.tsx?raw";
import scenarioEditorSource from "./features/forecast-simulation/ScenarioEditor.tsx?raw";

describe("product time-model terminology", () => {
  it("explains both product durations completely in administration", () => {
    expect(adminViewSource).toContain("Referenzzeit Offblock–Onblock (Min.)");
    expect(adminViewSource).toContain(
      "Operative Planzeit vom bestätigten Offblock bis zum bestätigten Onblock.",
    );
    expect(adminViewSource).toContain(
      "Trage hier weder die vollständige Umlaufzeit noch ausschließlich die beworbene Flugzeit ein.",
    );
    expect(adminViewSource).toContain("Kommunizierte Flugzeit (Min.)");
    expect(adminViewSource).toContain(
      "Dieser Wert wird in Produktinformationen verwendet und beeinflusst die operative Prognose nicht.",
    );
  });

  it("removes the resource-group duration and uses the same semantics in simulation", () => {
    expect(adminViewSource).not.toContain("plannedRotationMinutes");
    expect(adminViewSource).not.toContain("Plan-Umlaufzeit");
    expect(scenarioEditorSource).toContain("Referenzzeit Offblock–Onblock des Produkts");
  });
});
