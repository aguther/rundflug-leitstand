import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareTechnicalStrings } from "./lib/technical-order.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "scripts/refactor-guardrails.json");
const productionSourceRoots = ["apps", "packages"];
const testFilePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const productionTypeScriptPattern = /\.(?:ts|tsx)$/;
const rawImportPattern = /(?:\bfrom\s+|\bimport\s*)["']([^"']+\?raw)["']/g;
const moduleImportPattern = /(?:\bfrom\s+|\bimport\s*)["']([^"']+)["']/g;
const productionSourceReadPattern =
  /\breadFile(?:Sync)?\s*\(\s*new URL\(\s*["']([^"']+\.(?:ts|tsx))["']\s*,\s*import\.meta\.url\s*\)/g;
const forbiddenProductionRawImportTargets = new Set([
  "apps/web/src/admin-view.tsx",
  "apps/worker/src/event-coordinator.ts",
  "apps/worker/src/index.ts",
  "packages/contracts/src/index.ts",
]);

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function countLines(content) {
  if (content.length === 0) return 0;
  const normalized = content.replaceAll("\r\n", "\n");
  const trailingLine = normalized.endsWith("\n") ? 1 : 0;
  return normalized.split("\n").length - trailingLine;
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
}

export async function collectProductionRawImports(
  repositoryRoot = root,
  sourceRoots = productionSourceRoots,
) {
  const files = (
    await Promise.all(
      sourceRoots.map((sourceRoot) => collectFiles(resolve(repositoryRoot, sourceRoot))),
    )
  ).flat();
  const testFiles = files.filter((path) => testFilePattern.test(path));
  const imports = [];
  for (const testFile of testFiles) {
    const content = await readFile(testFile, "utf8");
    for (const match of content.matchAll(rawImportPattern)) {
      const specifier = match[1];
      const sourcePath = resolve(dirname(testFile), specifier.slice(0, -"?raw".length));
      const relativeSource = normalizePath(relative(repositoryRoot, sourcePath));
      if (
        relativeSource.startsWith("../") ||
        !productionTypeScriptPattern.test(relativeSource) ||
        testFilePattern.test(relativeSource) ||
        relativeSource.endsWith(".d.ts")
      ) {
        continue;
      }
      imports.push(`${normalizePath(relative(repositoryRoot, testFile))} -> ${relativeSource}`);
    }
  }
  return [...new Set(imports)].sort(compareTechnicalStrings);
}

export async function collectProductionSourceReads(
  repositoryRoot = root,
  sourceRoots = productionSourceRoots,
) {
  const files = (
    await Promise.all(
      sourceRoots.map((sourceRoot) => collectFiles(resolve(repositoryRoot, sourceRoot))),
    )
  ).flat();
  const reads = [];
  for (const testFile of files.filter((path) => testFilePattern.test(path))) {
    const content = await readFile(testFile, "utf8");
    for (const match of content.matchAll(productionSourceReadPattern)) {
      const sourcePath = resolve(dirname(testFile), match[1]);
      const relativeSource = normalizePath(relative(repositoryRoot, sourcePath));
      if (
        relativeSource.startsWith("../") ||
        testFilePattern.test(relativeSource) ||
        relativeSource.endsWith(".d.ts")
      ) {
        continue;
      }
      reads.push(`${normalizePath(relative(repositoryRoot, testFile))} -> ${relativeSource}`);
    }
  }
  return [...new Set(reads)].sort(compareTechnicalStrings);
}

export async function collectDomainExternalImports(repositoryRoot = root) {
  const domainSourceRoot = resolve(repositoryRoot, "packages", "domain", "src");
  const files = (await collectFiles(domainSourceRoot)).filter(
    (path) =>
      productionTypeScriptPattern.test(path) &&
      !testFilePattern.test(path) &&
      !path.endsWith(".d.ts"),
  );
  const imports = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(moduleImportPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) {
        imports.push(`${normalizePath(relative(repositoryRoot, file))} -> ${specifier}`);
      }
    }
  }
  return [...new Set(imports)].sort(compareTechnicalStrings);
}

export async function collectInternalDomainBarrelImports(repositoryRoot = root) {
  const domainSourceRoot = resolve(repositoryRoot, "packages", "domain", "src");
  const domainBarrel = resolve(domainSourceRoot, "index.ts");
  const files = (await collectFiles(domainSourceRoot)).filter(
    (path) =>
      productionTypeScriptPattern.test(path) &&
      !testFilePattern.test(path) &&
      !path.endsWith(".d.ts") &&
      path !== domainBarrel,
  );
  const imports = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(moduleImportPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const target = resolve(dirname(file), specifier.replace(/\.ts$/, ""));
      if (`${target}.ts` === domainBarrel) {
        imports.push(normalizePath(relative(repositoryRoot, file)));
      }
    }
  }
  return [...new Set(imports)].sort(compareTechnicalStrings);
}

async function verifySizeBudgets(config) {
  const failures = [];
  const observations = [];
  const budgets = [...config.sizeBudgets, ...config.extractedModuleBudgets];
  for (const budget of budgets) {
    const content = await readFile(resolve(root, budget.path), "utf8");
    const lines = countLines(content);
    observations.push(
      `${budget.path}: ${lines}/${budget.maxLines} lines (target ${budget.targetLines})`,
    );
    if (lines > budget.maxLines) {
      failures.push(`${budget.path} has ${lines} lines; the ratchet permits ${budget.maxLines}`);
    }
  }
  return { failures, observations };
}

async function run() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const currentRawImports = await collectProductionRawImports();
  const productionSourceReads = await collectProductionSourceReads();
  const domainExternalImports = await collectDomainExternalImports();
  const internalDomainBarrelImports = await collectInternalDomainBarrelImports();
  if (process.argv.includes("--write-baseline")) {
    config.allowedProductionRawImports = currentRawImports;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    console.log(`Updated raw-import baseline with ${currentRawImports.length} entries.`);
    return;
  }

  const allowedRawImports = new Set(config.allowedProductionRawImports);
  const currentRawImportSet = new Set(currentRawImports);
  const unexpected = currentRawImports.filter((entry) => !allowedRawImports.has(entry));
  const forbidden = currentRawImports.filter((entry) =>
    forbiddenProductionRawImportTargets.has(entry.split(" -> ")[1]),
  );
  const removedButNotRatcheted = config.allowedProductionRawImports.filter(
    (entry) => !currentRawImportSet.has(entry),
  );
  const { failures, observations } = await verifySizeBudgets(config);

  if (internalDomainBarrelImports.length > 0) {
    failures.push(
      `production domain modules importing their own public barrel:\n${internalDomainBarrelImports.join("\n")}`,
    );
  }

  if (productionSourceReads.length > 0) {
    failures.push(
      `tests reading production TypeScript as text:\n${productionSourceReads.join("\n")}`,
    );
  }

  if (domainExternalImports.length > 0) {
    failures.push(
      `production domain modules importing external adapters:\n${domainExternalImports.join("\n")}`,
    );
  }

  if (unexpected.length > 0) {
    failures.push(`new production TypeScript raw imports:\n${unexpected.join("\n")}`);
  }
  if (forbidden.length > 0) {
    failures.push(`forbidden target-file raw imports:\n${forbidden.join("\n")}`);
  }
  if (removedButNotRatcheted.length > 0) {
    failures.push(
      `removed raw imports still exist in the baseline; ratchet the snapshot:\n${removedButNotRatcheted.join("\n")}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`Refactor guardrails failed:\n\n${failures.join("\n\n")}`);
  }

  console.log(`OK: ${currentRawImports.length} production TypeScript source-text imports`);
  for (const observation of observations) console.log(observation);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run();
