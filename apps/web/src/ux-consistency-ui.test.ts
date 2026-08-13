import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import cashierSource from "./cashier-view.tsx?raw";
import productSalesDialogSource from "./features/admin/products/ProductSalesDialog.tsx?raw";
import flightLineSource from "./flight-line-view.tsx?raw";
import sharedSource from "./operation-workspace.tsx?raw";
import { readCssSource } from "./test-css-source";

const operationLabelsSource = readFileSync(
  new URL("./features/operations/operation-labels.ts", import.meta.url),
  "utf8",
);

const appSource = `${sharedSource}\n${operationLabelsSource}\n${productSalesDialogSource}\n${flightLineSource}\n${cashierSource}`;

const stylesSource = [
  readFileSync(new URL("./styles.css", import.meta.url), "utf8"),
  readCssSource(new URL("./features/admin/admin-v12.css", import.meta.url)),
].join("\n");
const productSalesStyles = readFileSync(
  new URL("./features/admin/products/product-sales-dialog.css", import.meta.url),
  "utf8",
);

describe("V1 UX consistency", () => {
  it("renders operational states and prediction quality with German labels", () => {
    expect(appSource).toContain('DRAFT: "Vorbereitung"');
    expect(appSource).toContain('CHANGING: "in Veränderung"');
    expect(appSource).toContain("rotationStatusLabel[selected.status]");
    expect(appSource).toContain("predictionQualityLabel[selected.timeline.predictionQuality]");
    expect(appSource).toContain("predictionQualityLabel[product.predictionQuality]");
  });

  it("provides touch-sized controls for frequent mobile administration", () => {
    expect(stylesSource).toMatch(/\.theme-toggle\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
    expect(stylesSource).toMatch(/\.admin-mode-bar\s*>\s*button\s*\{[^}]*min-height:\s*44px;/s);
    expect(stylesSource).toMatch(/\.localized-picker-trigger\s*\{[^}]*width:\s*46px;/s);
    expect(stylesSource).toMatch(/\.rotation-detail\s+select\s*\{[^}]*min-height:\s*44px;/s);
    expect(stylesSource).toMatch(/\.setup-checklist\s+button\s*\{[^}]*min-height:\s*44px;/s);
  });

  it("keeps localized product closing controls touch-sized with matching inline padding", () => {
    expect(productSalesStyles).toMatch(
      /\.product-sales-dialog \.localized-picker-control > input \{[\s\S]*?height: var\(--product-sales-control-height\);[\s\S]*?padding-inline: 12px 48px;/,
    );
  });
});
