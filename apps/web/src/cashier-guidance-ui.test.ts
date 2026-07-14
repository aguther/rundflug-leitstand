import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";

describe("cashier child companion warning UI", () => {
  it("renders a prominent accessible and non-safety-related warning", () => {
    expect(appSource).toContain('className="child-companion-warning" role="alert"');
    expect(appSource).toContain("Begleitung prüfen");
    expect(appSource).toContain("keine erwachsene Begleitperson");
    expect(appSource).toContain("ohne flugbetriebliche Freigabewirkung");
  });
});
