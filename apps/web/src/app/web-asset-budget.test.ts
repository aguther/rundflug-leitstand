import { describe, expect, it } from "vitest";
import {
  collectManifestFiles,
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

  it("enforces hard asset limits and the two-percent route regression ceiling", () => {
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
      "admin initial route rawBytes is 0.10 KiB; budget is 0.10 KiB",
    ]);
  });
});
