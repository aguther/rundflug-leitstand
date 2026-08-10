import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "../../admin-view.tsx?raw";
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
    expect(appSource).toContain('import "./features/admin/admin-v12.css"');
    expect(stylesSource).toContain("var(--ui-surface)");
    expect(stylesSource).toContain("var(--ui-bg)");
  });

  it("uses a dense table with an editor drawer", () => {
    expect(stylesSource).toContain("minmax(360px, 420px)");
    expect(stylesSource).toContain("height: 48px");
    expect(stylesSource).toContain(".master-data-drawer");
  });

  it("keeps cashier order out of product administration and sorts product choices alphabetically", () => {
    expect(appSource).not.toContain("Position in Anzeigen");
    expect(appSource).not.toContain("productSortOrder");
    expect(appSource).toContain("const alphabeticalProducts =");
    expect(appSource).toContain("adminTableCollator.compare(left.name, right.name)");
    expect(appSource).toContain("alphabeticalProducts.map((product)");
  });

  it("keeps event management and event creation in one modal flow", () => {
    expect(appSource).toContain('useState<"closed" | "catalog" | "create">(');
    expect(appSource).not.toContain('className="admin-section restart-editor"');
    expect(modernizationStylesSource).toContain(".event-create-dialog-form");
    expect(modernizationStylesSource).toContain(".event-create-dialog-footer");
    expect(stylesSource).toMatch(/\.admin-shell \.reset-levels\[hidden\]\s*\{\s*display: none;/);
  });

  it("makes technical event IDs visible, searchable and explicit during deletion", () => {
    expect(appSource).toContain("entry.name} $" + "{entry.eventId} $" + "{entry.eventDate");
    expect(appSource).toContain("Zum Bestätigen exakt");
    expect(appSource).toContain("eventId}“ eingeben");
    expect(modernizationStylesSource).toContain(".event-catalog-entry-id");
  });

  it("uses the desktop viewport without an avoidable page-level scrollbar", () => {
    expect(stylesSource).toContain("height: 100dvh");
    expect(stylesSource).toContain("overflow: hidden");
  });
});
