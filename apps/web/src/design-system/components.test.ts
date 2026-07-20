import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import mainSource from "../main.tsx?raw";

const stylesSource = readFileSync(new URL("./components.css", import.meta.url), "utf8");
const buttonSource = readFileSync(new URL("./components/Button.tsx", import.meta.url), "utf8");
const fieldSource = readFileSync(new URL("./components/Field.tsx", import.meta.url), "utf8");
const tabsSource = readFileSync(new URL("./components/Tabs.tsx", import.meta.url), "utf8");
const tableSource = readFileSync(new URL("./components/DataTable.tsx", import.meta.url), "utf8");
const sidePanelSource = readFileSync(
  new URL("./components/SidePanel.tsx", import.meta.url),
  "utf8",
);
const statusPillSource = readFileSync(
  new URL("./components/StatusPill.tsx", import.meta.url),
  "utf8",
);
const confirmSource = readFileSync(
  new URL("./components/ConfirmationDialog.tsx", import.meta.url),
  "utf8",
);
const modalSource = readFileSync(new URL("./components/ModalDialog.tsx", import.meta.url), "utf8");

describe("shared design-system component library", () => {
  it("loads the central component layers after legacy view styles", () => {
    expect(mainSource.indexOf('import "./design-system/base.css"')).toBeLessThan(
      mainSource.indexOf('import "./design-system/components.css"'),
    );
    expect(mainSource.indexOf('import "./styles.css"')).toBeLessThan(
      mainSource.indexOf('import "./design-system/base.css"'),
    );
  });

  it("Button exposes shared variants and sizes instead of view-specific classes", () => {
    expect(buttonSource).toContain("ds-button--primary");
    expect(buttonSource).toContain("ds-button--secondary");
    expect(buttonSource).toContain("ds-button--danger");
    expect(buttonSource).toContain('type ButtonSize = "compact" | "default" | "touch"');
    expect(buttonSource).toMatch(/ds-button--\$\{size\}/);
    expect(stylesSource).toContain(".ds-button--compact");
  });

  it("provides shared fields and scrollbar-stable tabs", () => {
    expect(fieldSource).toContain("ds-field");
    expect(fieldSource).toContain("useId");
    expect(fieldSource).toContain("SearchField");
    expect(fieldSource).toContain("ds-search-control");
    expect(tabsSource).toContain('role="tablist"');
    expect(tabsSource).toContain('role="tab"');
    expect(stylesSource).toContain("scrollbar-width: none");
    expect(stylesSource).toContain(".ds-tabs::-webkit-scrollbar");
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

  it("ConfirmationDialog reuses the focus-managed modal primitive", () => {
    expect(confirmSource).toContain("autoFocus");
    expect(confirmSource).toContain("<ModalDialog");
    expect(modalSource).toContain('event.key === "Escape"');
    expect(modalSource).toContain('event.key !== "Tab"');
    expect(modalSource).toContain("previousFocus?.focus()");
    expect(modalSource).toContain("ds-modal-backdrop-dismiss");
    expect(stylesSource).toContain(".ds-modal-body");
    expect(stylesSource).toContain("overflow: auto");
  });

  it("stays token-driven and free of gradients, matching the non-tactile surfaces it serves", () => {
    expect(stylesSource).not.toMatch(/(?:linear|radial)-gradient\(/);
    expect(stylesSource).toContain("var(--ui-accent)");
  });
});
