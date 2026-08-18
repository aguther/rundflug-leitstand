import { describe, expect, it } from "vitest";
import {
  collectManifestFiles,
  verifyPrecachePolicy,
  verifyWebAssetReport,
} from "../../../../scripts/verify_web_assets.mjs";

describe("web asset budgets", () => {
  it("collects static route dependencies without pulling dynamic feature chunks", () => {
    const manifest = {
      "index.html": {
        file: "assets/index.js",
        imports: ["shared"],
        dynamicImports: ["admin"],
        css: ["assets/index.css"],
      },
      shared: { file: "assets/shared.js", assets: ["assets/font.woff2"] },
      admin: {
        file: "assets/admin.js",
        imports: ["shared"],
        dynamicImports: ["analysis"],
        css: ["assets/admin.css"],
      },
      analysis: { file: "assets/analysis.js" },
    };

    expect(collectManifestFiles(manifest, ["index.html", "admin"])).toEqual([
      "assets/admin.css",
      "assets/admin.js",
      "assets/font.woff2",
      "assets/index.css",
      "assets/index.js",
      "assets/shared.js",
    ]);
  });

  it("enforces hard limits, ten-percent headroom, and the route regression ceiling", () => {
    const report = {
      assets: { globalCss: { rawBytes: 121, gzipBytes: 20 } },
      routes: { admin: { rawBytes: 103, gzipBytes: 100 } },
    };
    const baseline = {
      routes: { admin: { rawBytes: 100, gzipBytes: 100 } },
    };
    const failures = verifyWebAssetReport(report, baseline, {
      globalCss: { rawBytes: 120, gzipBytes: 24 },
    });

    expect(failures).toEqual([
      "globalCss rawBytes is 0.12 KiB; budget is 0.12 KiB",
      "globalCss 10% headroom rawBytes is 0.12 KiB; budget is 0.11 KiB",
      "admin initial route rawBytes is 0.10 KiB; budget is 0.10 KiB",
    ]);
  });

  it("requires operational entries and CSS while excluding online-only entries", () => {
    const manifest = {
      "src/cashier-view.tsx": {
        file: "assets/cashier.js",
        css: ["assets/cashier.css"],
      },
      "src/fids-view.tsx": { file: "assets/fids.js", imports: ["fidsStyles"] },
      "src/flight-director-view.tsx": {
        file: "assets/flight-director.js",
        css: ["assets/flight-director.css"],
      },
      "src/flight-line-view.tsx": {
        file: "assets/flight-line.js",
        css: ["assets/flight-line.css"],
      },
      fidsStyles: { file: "assets/fids-support.js", css: ["assets/fids.css"] },
      "src/admin-view.tsx": {
        file: "assets/admin.js",
        css: ["assets/admin.css"],
      },
      "src/features/flight-line/FlightDirectorAnalyticsContent.tsx": {
        file: "assets/FlightDirectorAnalyticsContent.js",
        css: ["assets/FlightDirectorAnalyticsContent.css"],
      },
      "src/features/forecast-simulation/ForecastSimulationView.tsx": {
        file: "assets/ForecastSimulationView.js",
        css: ["assets/ForecastSimulationView.css"],
      },
    };
    const precacheFiles = [
      "assets/cashier.js",
      "assets/cashier.css",
      "assets/fids.js",
      "assets/fids.css",
      "assets/flight-director.js",
      "assets/flight-director.css",
      "assets/flight-line.js",
      "assets/flight-line.css",
      "assets/admin.js",
      "assets/FlightDirectorAnalyticsContent.css",
      "assets/comparison-worker-abc.js",
      "assets/engine-abc.js",
      "assets/model-abc.js",
      "assets/ScenarioEditor-abc.js",
      "assets/SimulationComparisonDialog-abc.js",
      "assets/SimulationSeedBatchDialog-abc.js",
      "assets/seed-batch-worker-abc.js",
      "assets/ForecastStabilityHistogram-abc.js",
    ];

    expect(verifyPrecachePolicy(manifest, precacheFiles)).toEqual([
      "Online-only PWA file is precached for admin: assets/admin.js",
      "Online-only PWA file is precached for analytics: assets/FlightDirectorAnalyticsContent.css",
      "Online-only PWA file is precached for comparisonWorker: assets/comparison-worker-abc.js",
      "Online-only PWA file is precached for simulationEngine: assets/engine-abc.js",
      "Online-only PWA file is precached for simulationModel: assets/model-abc.js",
      "Online-only PWA file is precached for scenarioEditor: assets/ScenarioEditor-abc.js",
      "Online-only PWA file is precached for simulationComparisonDialog: assets/SimulationComparisonDialog-abc.js",
      "Online-only PWA file is precached for seedBatchDialog: assets/SimulationSeedBatchDialog-abc.js",
      "Online-only PWA file is precached for seedBatchWorker: assets/seed-batch-worker-abc.js",
      "Online-only PWA file is precached for stabilityHistogram: assets/ForecastStabilityHistogram-abc.js",
    ]);
  });
});
