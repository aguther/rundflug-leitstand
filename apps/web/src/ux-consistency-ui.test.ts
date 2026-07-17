import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminSource from "./admin-view.tsx?raw";
import cashierSource from "./cashier-view.tsx?raw";
import flightLineSource from "./flight-line-view.tsx?raw";
import sharedSource from "./operation-workspace.tsx?raw";

const appSource = `${sharedSource}\n${adminSource}\n${flightLineSource}\n${cashierSource}`;

const stylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("V1 UX consistency", () => {
  it("renders operational states and prediction quality with German labels", () => {
    expect(appSource).toContain('DRAFT: "Vorbereitung"');
    expect(appSource).toContain('CHANGING: "in Veränderung"');
    expect(appSource).toContain("rotationStatusLabel[selected.status]");
    expect(appSource).toContain("predictionQualityLabel[selected.timeline.predictionQuality]");
    expect(appSource).toContain("predictionQualityLabel[product.predictionQuality]");
  });

  it("keeps account and session controls secondary to the current editor action", () => {
    expect(appSource).toContain('className="secondary-action"');
    expect(appSource).toContain('session?.account.role === "ADMIN"');
    expect(appSource).toContain("void logout().then(() => window.location.reload())");
    expect(appSource).not.toContain(
      'className={adminModeUnlocked ? "secondary-action" : "primary-action"}',
    );
  });

  it("provides touch-sized controls for frequent mobile administration", () => {
    expect(stylesSource).toMatch(/\.theme-toggle\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
    expect(stylesSource).toMatch(/\.admin-mode-bar\s*>\s*button\s*\{[^}]*min-height:\s*44px;/s);
    expect(stylesSource).toMatch(/\.localized-picker-trigger\s*\{[^}]*width:\s*46px;/s);
    expect(stylesSource).toMatch(/\.rotation-detail\s+select\s*\{[^}]*min-height:\s*44px;/s);
    expect(stylesSource).toMatch(/\.setup-checklist\s+button\s*\{[^}]*min-height:\s*44px;/s);
  });
});
