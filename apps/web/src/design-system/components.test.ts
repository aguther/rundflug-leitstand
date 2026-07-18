import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import mainSource from "../main.tsx?raw";

const stylesSource = readFileSync(new URL("./components.css", import.meta.url), "utf8");
const buttonSource = readFileSync(new URL("./components/Button.tsx", import.meta.url), "utf8");
const tableSource = readFileSync(new URL("./components/DataTable.tsx", import.meta.url), "utf8");
const sidePanelSource = readFileSync(new URL("./components/SidePanel.tsx", import.meta.url), "utf8");
const statusPillSource = readFileSync(new URL("./components/StatusPill.tsx", import.meta.url), "utf8");
const confirmSource = readFileSync(new URL("./components/ConfirmationDialog.tsx", import.meta.url), "utf8");

describe("shared design-system component library", () => {
  it("loads components.css after base.css and before the legacy stylesheet", () => {
    expect(mainSource.indexOf('import "./design-system/base.css"')).toBeLessThan(
      mainSource.indexOf('import "./design-system/components.css"'),
    );
    expect(mainSource.indexOf('import "./design-system/components.css"')).toBeLessThan(
      mainSource.indexOf('import "./styles.css"'),
    );
  });

  it("Button reuses the existing action button classes instead of inventing new ones", () => {
    expect(buttonSource).toContain("primary-action");
    expect(buttonSource).toContain("secondary-action");
    expect(buttonSource).toContain("danger-action");
  });

  it("StatusPill exposes a tone-based API backed by semantic tokens", () => {
    expect(statusPillSource).toContain("ds-status-pill--");
    expect(stylesSource).toContain(".ds-status-pill--success");
    expect(stylesSource).toContain(".ds-status-pill--warning");
    expect(stylesSource).toContain(".ds-status-pill--danger");
    expect(stylesSource).toContain(".ds-status-pill--info");
    expect(stylesSource).toContain(".ds-status-pill--neutral");
  });

  it("DataTable wraps rows in an internally scrolling container with a sticky header and pagination", () => {
    expect(tableSource).toContain("ds-table-scroll");
    expect(tableSource).toContain("pageSize");
    expect(stylesSource).toContain(".ds-table thead th");
    expect(stylesSource).toContain("position: sticky");
    expect(stylesSource).toContain(".ds-pagination");
  });

  it("SidePanel adapts to a bottom sheet on narrow viewports and exposes dialog semantics", () => {
    expect(sidePanelSource).toContain('role="dialog"');
    expect(stylesSource).toMatch(/@media \(max-width: 760px\) \{\s*\.ds-sidepanel \{/);
  });

  it("ConfirmationDialog auto-focuses its primary action and submits on Enter", () => {
    expect(confirmSource).toContain("autoFocus");
    expect(confirmSource).toContain("onSubmit");
  });

  it("stays token-driven and free of gradients, matching the non-tactile surfaces it serves", () => {
    expect(stylesSource).not.toMatch(/(?:linear|radial)-gradient\(/);
    expect(stylesSource).toContain("var(--ui-accent)");
  });
});
