import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminSource from "../../../admin-view.tsx?raw";

const styles = readFileSync(new URL("./event-parameters.css", import.meta.url), "utf8");
const workspaceStyles = readFileSync(
  new URL("../event-workspace/event-workspace.css", import.meta.url),
  "utf8",
);

describe("event parameter surface", () => {
  it("uses one scoped control height and centers values and units", () => {
    expect(styles).toContain("--event-parameter-control-height: var(--control-touch)");
    expect(styles).toMatch(
      /\.admin-shell \.event-parameters-workspace \.localized-picker-control > input,[\s\S]*?\.event-parameter-number-control \{[\s\S]*?height: var\(--event-parameter-control-height\);/,
    );
    expect(styles).toMatch(
      /\.event-parameter-number-control input \{[\s\S]*?box-sizing: border-box;[\s\S]*?line-height: 1\.35;/,
    );
    expect(styles).toMatch(
      /\.event-parameter-number-control\s+> \.event-parameter-number-unit \{[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?line-height: 1\.35;/,
    );
    expect(styles).not.toMatch(/Boarding|Ausstieg|Puffer|No-Show|Zurückstellungen/);
  });

  it("aligns decorative turnaround separators to the shared control height", () => {
    expect(styles).toMatch(
      /\.event-turnaround-fields > span \{[\s\S]*?height: var\(--event-parameter-control-height\);[\s\S]*?place-items: center;/,
    );
  });

  it("keeps operation planning outside the parameter workspace", () => {
    expect(adminSource).toContain("<EventParametersWorkspace");
    expect(adminSource).toContain("<OperationalPlanPanel");
    expect(adminSource).toContain("<OperationsWorkspace");
  });

  it("guards internal navigation and browser unload while values are dirty", () => {
    expect(adminSource).toContain('window.addEventListener("beforeunload"');
    expect(adminSource).toContain("requestEventParameterNavigation");
    expect(adminSource).toContain("discardEventNavigationOpen");
  });

  it("uses a bounded responsive workspace and exactly one mobile action bar", () => {
    expect(workspaceStyles).toContain("--event-workspace-max-width: 1180px");
    expect(styles).toContain(".event-parameters-mobile-actions");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr)");
  });
});
