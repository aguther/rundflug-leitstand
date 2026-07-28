import { describe, expect, it } from "vitest";

import { nextSimulationVariantName } from "./SimulationFoundationDialog";

describe("simulation foundation variants", () => {
  it("keeps new names and numbers collisions without exceeding the input limit", () => {
    expect(nextSimulationVariantName("Normalbetrieb", ["Variante 1"])).toBe("Normalbetrieb");
    expect(nextSimulationVariantName("Normalbetrieb", ["Normalbetrieb", "Normalbetrieb (2)"])).toBe(
      "Normalbetrieb (3)",
    );
    expect(nextSimulationVariantName("A".repeat(80), ["A".repeat(80)])).toHaveLength(80);
  });
});
