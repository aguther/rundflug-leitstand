import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import featureRouterSource from "../../FeatureRouter.tsx?raw";

const stylesSource = readFileSync(new URL("./admin-v12.css", import.meta.url), "utf8");
const modernizationStylesSource = readFileSync(
  new URL("./admin-modernization.css", import.meta.url),
  "utf8",
);
const legacyStylesSource = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

describe("V1.2 compact administration", () => {
  it("inherits the shared application header without admin-only geometry overrides", () => {
    expect(stylesSource).not.toContain(".app-shell.admin-shell > .app-header");
    expect(legacyStylesSource).not.toContain(".admin-shell > .app-header");
  });

  it("loads the semantic administration layer with the lazy administration route", () => {
    expect(featureRouterSource).toContain('import("./admin-view")');
    expect(stylesSource).toContain("var(--ui-surface)");
    expect(stylesSource).toContain("var(--ui-bg)");
  });

  it("uses a dense table with an editor drawer", () => {
    expect(stylesSource).toContain("minmax(360px, 420px)");
    expect(stylesSource).toContain("height: 48px");
    expect(stylesSource).toContain(".master-data-drawer");
  });

  it("styles event management and creation as one modal flow", () => {
    expect(modernizationStylesSource).toContain(".event-create-dialog-form");
    expect(modernizationStylesSource).toContain(".event-create-dialog-footer");
    expect(modernizationStylesSource).toContain(".event-catalog-entry-id");
    expect(stylesSource).toMatch(/\.admin-shell \.reset-levels\[hidden\]\s*\{\s*display: none;/);
  });

  it("uses the desktop viewport without an avoidable page-level scrollbar", () => {
    expect(stylesSource).toContain("height: 100dvh");
    expect(stylesSource).toContain("overflow: hidden");
  });
});
