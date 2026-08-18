import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { compareTechnicalStrings } from "./lib/technical-order.mjs";
import { GIT_EXECUTABLE } from "./lib/tool-executables.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const WEB_ASSET_BUDGETS = {
  globalCss: { rawBytes: 98_044, gzipBytes: 18_215 },
  flightLineCss: { rawBytes: 74_161, gzipBytes: 11_933 },
  adminEntry: { rawBytes: 180 * 1024, gzipBytes: 48 * 1024 },
  mainEntry: { rawBytes: 215 * 1024, gzipBytes: 68 * 1024 },
  largestJavaScriptChunk: { rawBytes: 327_418, gzipBytes: 96_085 },
  pwaPrecache: { rawBytes: 1_396_000 },
};

export const WEB_ASSET_MINIMUM_HEADROOM_RATIO = 0.1;

export const WEB_ROUTE_ENTRIES = {
  admin: "src/admin-view.tsx",
  cashier: "src/cashier-view.tsx",
  fids: "src/fids-view.tsx",
  flightDirector: "src/flight-director-view.tsx",
  flightLine: "src/flight-line-view.tsx",
  groupStatus: "src/group-status-view.tsx",
  privacy: "src/privacy-view.tsx",
  setup: "src/setup-view.tsx",
  simulation: "src/features/forecast-simulation/ForecastSimulationView.tsx",
  ticketStatus: "src/ticket-status-view.tsx",
};

const ENTRY_KEY = "index.html";
const ROUTER_KEY = "src/FeatureRouter.tsx";
const REQUIRED_PRECACHE_ENTRIES = {
  cashier: WEB_ROUTE_ENTRIES.cashier,
  fids: WEB_ROUTE_ENTRIES.fids,
  flightDirector: WEB_ROUTE_ENTRIES.flightDirector,
  flightLine: WEB_ROUTE_ENTRIES.flightLine,
};
const EXCLUDED_PRECACHE_ENTRIES = {
  admin: WEB_ROUTE_ENTRIES.admin,
  analytics: "src/features/flight-line/FlightDirectorAnalyticsContent.tsx",
  simulation: WEB_ROUTE_ENTRIES.simulation,
};
const EXCLUDED_PRECACHE_FILE_PATTERNS = {
  analyticsModel: /^assets\/flight-director-analytics-model-.*\.js$/,
  comparisonWorker: /^assets\/comparison-worker-.*\.js$/,
  simulationEngine: /^assets\/engine-.*\.js$/,
  simulationModel: /^assets\/model-.*\.js$/,
  scenarioEditor: /^assets\/ScenarioEditor-.*\.js$/,
  simulationComparisonDialog: /^assets\/SimulationComparisonDialog-.*\.js$/,
  seedBatchDialog: /^assets\/SimulationSeedBatchDialog-.*\.js$/,
  seedBatchWorker: /^assets\/seed-batch-worker-.*\.js$/,
  stabilityHistogram: /^assets\/ForecastStabilityHistogram-.*\.js$/,
};
const defaultDistDirectory = resolve(repositoryRoot, "apps/web/dist");
const defaultBaselinePath = resolve(repositoryRoot, "scripts/data/web-asset-baseline.json");

function formatKilobytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function requireManifestEntry(manifest, key) {
  const entry = manifest[key];
  if (!entry) throw new Error(`Vite manifest entry is missing: ${key}`);
  return entry;
}

export function collectManifestFiles(manifest, entryKeys) {
  const files = new Set();
  const visited = new Set();
  const pending = [...entryKeys];
  while (pending.length > 0) {
    const key = pending.pop();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    const entry = requireManifestEntry(manifest, key);
    if (entry.file) files.add(entry.file);
    for (const file of entry.css ?? []) files.add(file);
    for (const file of entry.assets ?? []) files.add(file);
    for (const importedKey of entry.imports ?? []) pending.push(importedKey);
  }
  return [...files].sort(compareTechnicalStrings);
}

async function measureFiles(distDirectory, files) {
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const content = await readFile(resolve(distDirectory, file));
    rawBytes += content.byteLength;
    gzipBytes += gzipSync(content).byteLength;
  }
  return { rawBytes, gzipBytes };
}

async function measureManifestEntryFile(distDirectory, manifest, key) {
  const entry = requireManifestEntry(manifest, key);
  return measureFiles(distDirectory, [entry.file]);
}

async function measureManifestEntryCss(distDirectory, manifest, key) {
  const entry = requireManifestEntry(manifest, key);
  return measureFiles(distDirectory, entry.css ?? []);
}

function extractPrecacheUrls(serviceWorkerSource) {
  const match = serviceWorkerSource.match(/precacheAndRoute\((\[[\s\S]*?\]),\{\}\)/);
  if (!match) throw new Error("PWA precache manifest is missing from sw.js");
  const urls = [...match[1].matchAll(/\{url:"([^"]+)"/g)].map((entry) => entry[1]);
  if (urls.length === 0) throw new Error("PWA precache manifest contains no URLs");
  return urls;
}

function collectEntryCssFiles(manifest, key) {
  return collectManifestFiles(manifest, [key]).filter((file) => file.endsWith(".css"));
}

function findMissingRequiredPrecacheFiles(manifest, precache) {
  const failures = [];
  for (const [label, key] of Object.entries(REQUIRED_PRECACHE_ENTRIES)) {
    const entry = requireManifestEntry(manifest, key);
    const requiredFiles = [entry.file, ...collectEntryCssFiles(manifest, key)];
    for (const file of requiredFiles) {
      if (!precache.has(file)) {
        failures.push(`Required PWA precache file is missing for ${label}: ${file}`);
      }
    }
  }
  return failures;
}

function findExcludedPrecacheEntries(manifest, precache) {
  const failures = [];
  for (const [label, key] of Object.entries(EXCLUDED_PRECACHE_ENTRIES)) {
    const entry = requireManifestEntry(manifest, key);
    for (const file of [entry.file, ...(entry.css ?? [])]) {
      if (precache.has(file)) {
        failures.push(`Online-only PWA file is precached for ${label}: ${file}`);
      }
    }
  }
  return failures;
}

function findExcludedPrecachePatterns(precacheFiles) {
  const failures = [];
  for (const [label, pattern] of Object.entries(EXCLUDED_PRECACHE_FILE_PATTERNS)) {
    for (const file of precacheFiles) {
      if (pattern.test(file)) {
        failures.push(`Online-only PWA file is precached for ${label}: ${file}`);
      }
    }
  }
  return failures;
}

export function verifyPrecachePolicy(manifest, precacheFiles) {
  const precache = new Set(precacheFiles);
  return [
    ...findMissingRequiredPrecacheFiles(manifest, precache),
    ...findExcludedPrecacheEntries(manifest, precache),
    ...findExcludedPrecachePatterns(precacheFiles),
  ];
}

async function readSourceRevision() {
  return execFileSync(GIT_EXECUTABLE, ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

export async function createWebAssetReport({
  distDirectory = defaultDistDirectory,
  sourceRevision,
} = {}) {
  const manifest = JSON.parse(
    await readFile(resolve(distDirectory, ".vite/manifest.json"), "utf8"),
  );
  const globalCss = await measureManifestEntryCss(distDirectory, manifest, ENTRY_KEY);
  const flightLineCss = await measureManifestEntryCss(
    distDirectory,
    manifest,
    WEB_ROUTE_ENTRIES.flightLine,
  );
  const adminEntry = await measureManifestEntryFile(
    distDirectory,
    manifest,
    WEB_ROUTE_ENTRIES.admin,
  );
  const mainEntry = await measureManifestEntryFile(distDirectory, manifest, ENTRY_KEY);
  const javascriptFiles = [
    ...new Set(
      Object.values(manifest)
        .map((entry) => entry.file)
        .filter((file) => file?.endsWith(".js")),
    ),
  ];
  let largestJavaScriptChunk = { file: "", rawBytes: 0, gzipBytes: 0 };
  for (const file of javascriptFiles) {
    const measured = await measureFiles(distDirectory, [file]);
    if (measured.rawBytes > largestJavaScriptChunk.rawBytes) {
      largestJavaScriptChunk = { file, ...measured };
    }
  }
  const serviceWorkerSource = await readFile(resolve(distDirectory, "sw.js"), "utf8");
  const precacheFiles = extractPrecacheUrls(serviceWorkerSource);
  const pwaPrecache = {
    entries: precacheFiles.length,
    rawBytes: (await Promise.all(precacheFiles.map((file) => stat(resolve(distDirectory, file)))))
      .map((file) => file.size)
      .reduce((sum, size) => sum + size, 0),
    policyFailures: verifyPrecachePolicy(manifest, precacheFiles),
  };
  const routes = {};
  for (const [route, routeEntry] of Object.entries(WEB_ROUTE_ENTRIES)) {
    const files = collectManifestFiles(manifest, [ENTRY_KEY, ROUTER_KEY, routeEntry]);
    routes[route] = { files, ...(await measureFiles(distDirectory, files)) };
  }
  return {
    schemaVersion: 1,
    sourceRevision: sourceRevision ?? (await readSourceRevision()),
    assets: {
      globalCss,
      flightLineCss,
      adminEntry,
      mainEntry,
      largestJavaScriptChunk,
      pwaPrecache,
    },
    routes,
  };
}

function compareMetric(failures, label, actual, maximum) {
  for (const metric of ["rawBytes", "gzipBytes"]) {
    if (maximum[metric] !== undefined && actual[metric] > maximum[metric]) {
      failures.push(
        `${label} ${metric} is ${formatKilobytes(actual[metric])}; budget is ${formatKilobytes(maximum[metric])}`,
      );
    }
  }
}

export function verifyWebAssetReport(report, baseline, budgets = WEB_ASSET_BUDGETS) {
  const failures = [];
  for (const [asset, budget] of Object.entries(budgets)) {
    compareMetric(failures, asset, report.assets[asset], budget);
    const headroomBudget = Object.fromEntries(
      Object.entries(budget).map(([metric, maximum]) => [
        metric,
        Math.floor(maximum * (1 - WEB_ASSET_MINIMUM_HEADROOM_RATIO)),
      ]),
    );
    compareMetric(failures, `${asset} 10% headroom`, report.assets[asset], headroomBudget);
  }
  failures.push(...(report.assets.pwaPrecache?.policyFailures ?? []));
  for (const [route, baselineMetrics] of Object.entries(baseline.routes)) {
    const actual = report.routes[route];
    if (!actual) {
      failures.push(`Route is missing from the current asset report: ${route}`);
      continue;
    }
    compareMetric(failures, `${route} initial route`, actual, {
      rawBytes: Math.floor(baselineMetrics.rawBytes * 1.02),
      gzipBytes: Math.floor(baselineMetrics.gzipBytes * 1.02),
    });
  }
  return failures;
}

function formatBudgetMetric(actual, budget) {
  const reserve = budget - actual;
  const reservePercent = (reserve / budget) * 100;
  return `budget ${budget} B, actual ${actual} B, reserve ${reserve} B (${reservePercent.toFixed(2)}%)`;
}

function printReport(report, baseline) {
  for (const [asset, budget] of Object.entries(WEB_ASSET_BUDGETS)) {
    const metrics = report.assets[asset];
    for (const metric of ["rawBytes", "gzipBytes"]) {
      if (budget[metric] !== undefined) {
        console.log(`${asset} ${metric}: ${formatBudgetMetric(metrics[metric], budget[metric])}`);
      }
    }
  }
  for (const [route, metrics] of Object.entries(report.routes)) {
    const baselineMetrics = baseline?.routes[route];
    if (!baselineMetrics) {
      console.log(
        `route ${route}: ${formatKilobytes(metrics.rawBytes)} raw / ${formatKilobytes(metrics.gzipBytes)} gzip`,
      );
      continue;
    }
    for (const metric of ["rawBytes", "gzipBytes"]) {
      const routeBudget = Math.floor(baselineMetrics[metric] * 1.02);
      console.log(`route ${route} ${metric}: ${formatBudgetMetric(metrics[metric], routeBudget)}`);
    }
  }
}

async function run() {
  const args = process.argv.slice(2);
  const distIndex = args.indexOf("--dist");
  const distDirectory =
    distIndex >= 0 ? resolve(repositoryRoot, args[distIndex + 1]) : defaultDistDirectory;
  const baselineIndex = args.indexOf("--write-baseline");
  const report = await createWebAssetReport({
    distDirectory,
    sourceRevision: baselineIndex >= 0 ? args[baselineIndex + 1] : undefined,
  });
  const baseline =
    baselineIndex < 0 ? JSON.parse(await readFile(defaultBaselinePath, "utf8")) : undefined;
  printReport(report, baseline);
  if (baselineIndex >= 0) {
    await writeFile(defaultBaselinePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote baseline snapshot: ${defaultBaselinePath}`);
    return;
  }
  if (args.includes("--report-only")) return;
  const failures = verifyWebAssetReport(report, baseline);
  if (failures.length > 0) {
    throw new Error(`Web asset budgets failed:\n- ${failures.join("\n- ")}`);
  }
  console.log("Web asset budgets passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
