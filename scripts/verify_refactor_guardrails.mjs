import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "scripts/refactor-guardrails.json");
const testFilePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const productionTypeScriptPattern = /\.(?:ts|tsx)$/;
const rawImportPattern = /(?:\bfrom\s+|\bimport\s*)["']([^"']+\?raw)["']/g;

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

async function collectProductionRawImports() {
  const testFiles = (await collectFiles(root)).filter((path) => testFilePattern.test(path));
  const imports = [];
  for (const testFile of testFiles) {
    const content = await readFile(testFile, "utf8");
    for (const match of content.matchAll(rawImportPattern)) {
      const specifier = match[1];
      const sourcePath = resolve(dirname(testFile), specifier.slice(0, -"?raw".length));
      const relativeSource = normalizePath(relative(root, sourcePath));
      if (
        relativeSource.startsWith("../") ||
        !productionTypeScriptPattern.test(relativeSource) ||
        testFilePattern.test(relativeSource) ||
        relativeSource.endsWith(".d.ts")
      ) {
        continue;
      }
      imports.push(`${normalizePath(relative(root, testFile))} -> ${relativeSource}`);
    }
  }
  return [...new Set(imports)].sort();
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
  if (process.argv.includes("--write-baseline")) {
    config.allowedProductionRawImports = currentRawImports;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    console.log(`Updated raw-import baseline with ${currentRawImports.length} entries.`);
    return;
  }

  const allowedRawImports = new Set(config.allowedProductionRawImports);
  const currentRawImportSet = new Set(currentRawImports);
  const unexpected = currentRawImports.filter((entry) => !allowedRawImports.has(entry));
  const removedButNotRatcheted = config.allowedProductionRawImports.filter(
    (entry) => !currentRawImportSet.has(entry),
  );
  const { failures, observations } = await verifySizeBudgets(config);

  if (unexpected.length > 0) {
    failures.push(`new production TypeScript raw imports:\n${unexpected.join("\n")}`);
  }
  if (removedButNotRatcheted.length > 0) {
    failures.push(
      `removed raw imports still exist in the baseline; ratchet the snapshot:\n${removedButNotRatcheted.join("\n")}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`Refactor guardrails failed:\n\n${failures.join("\n\n")}`);
  }

  console.log(`OK: ${currentRawImports.length} grandfathered production raw imports; no additions`);
  for (const observation of observations) console.log(observation);
}

await run();
