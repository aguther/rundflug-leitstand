import { describe, expect, it } from "vitest";
import scenarioEditorSource from "./features/forecast-simulation/ScenarioEditor.tsx?raw";

describe("product time-model terminology", () => {
  it("uses the product reference duration semantics in simulation", () => {
    expect(scenarioEditorSource).toContain("Referenzzeit Offblock–Onblock des Produkts");
  });
});
