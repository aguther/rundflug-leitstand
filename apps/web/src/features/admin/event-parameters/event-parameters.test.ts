import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminSource from "../../../admin-view.tsx?raw";

const styles = readFileSync(new URL("./event-parameters.css", import.meta.url), "utf8");

describe("event parameter surface", () => {
  it("centers values and units vertically inside the shared number control", () => {
    expect(styles).toMatch(/\.event-parameter-number-control input \{[\s\S]*?line-height: 1;/);
    expect(styles).toMatch(
      /\.event-parameter-number-control > span \{[\s\S]*?place-items: center;[\s\S]*?line-height: 1;/,
    );
  });

  it("keeps operation planning outside the parameter workspace", () => {
    expect(adminSource).toContain("<EventParametersWorkspace");
    expect(adminSource).toContain("<OperationalPlanPanel");
    expect(adminSource).toContain('hidden={eventStep !== "operations"}');
  });

  it("guards internal navigation and browser unload while values are dirty", () => {
    expect(adminSource).toContain('window.addEventListener("beforeunload"');
    expect(adminSource).toContain("requestEventParameterNavigation");
    expect(adminSource).toContain("discardEventNavigationOpen");
  });

  it("uses a bounded responsive workspace and exactly one mobile action bar", () => {
    expect(styles).toContain("width: min(100%, 1280px)");
    expect(styles).toContain(".event-parameters-mobile-actions");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr)");
  });
});
