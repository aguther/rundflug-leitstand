import { access, readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareTechnicalStrings } from "./lib/technical-order.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const auditPath = resolve(root, "scripts/worker-sql-test-oracles.json");
const sqlOracleFamilyPattern = /(?:service|history|routes)\.test\.ts$/;
const directSqlOraclePattern =
  /(?:\.sql|\bsql\(\)|\bsql\b)\)\.(?:not\.)?toContain|findStatement\(|harness\.sql\(\)\)\.(?:not\.)?toContain/;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
}

const normalizePath = (path) => path.replaceAll("\\", "/");

export async function collectWorkerSqlOracleFiles(repositoryRoot = root) {
  const sourceRoot = resolve(repositoryRoot, "apps/worker/src");
  const files = await collectFiles(sourceRoot);
  const matches = [];
  for (const file of files.filter((candidate) => sqlOracleFamilyPattern.test(candidate))) {
    if (directSqlOraclePattern.test(await readFile(file, "utf8"))) {
      matches.push(normalizePath(relative(repositoryRoot, file)));
    }
  }
  return matches.sort(compareTechnicalStrings);
}

export async function verifyWorkerSqlTestOracles(
  repositoryRoot = root,
  configuredAuditPath = auditPath,
) {
  const audit = JSON.parse(await readFile(configuredAuditPath, "utf8"));
  if (audit.version !== 1) throw new Error("Worker SQL oracle audit has an unsupported version.");
  const priorityA = [...audit.priorityAFiles].sort(compareTechnicalStrings);
  const behaviorBacked = Object.keys(audit.behaviorBackedFiles).sort(compareTechnicalStrings);
  const audited = [...priorityA, ...behaviorBacked].sort(compareTechnicalStrings);
  if (audited.length !== 36 || new Set(audited).size !== 36)
    throw new Error(
      `Worker SQL oracle audit must classify exactly 36 unique files; found ${new Set(audited).size}.`,
    );
  if (priorityA.length !== 0)
    throw new Error(
      `Worker SQL oracle audit must keep the priority-A backlog empty; found ${priorityA.length}.`,
    );
  for (const [file, evidence] of Object.entries(audit.behaviorBackedFiles)) {
    if (!Array.isArray(evidence) || evidence.length === 0)
      throw new Error(`${file} has no behavioral evidence.`);
    await access(resolve(repositoryRoot, file));
    for (const reference of evidence.filter((entry) => entry.includes("/")))
      await access(resolve(repositoryRoot, reference));
  }
  const detected = await collectWorkerSqlOracleFiles(repositoryRoot);
  const unexpected = detected.filter((file) => !audited.includes(file));
  const stale = audited.filter((file) => !detected.includes(file));
  if (unexpected.length > 0 || stale.length > 0) {
    throw new Error(
      [
        unexpected.length > 0 ? `New SQL-shape oracle families:\n${unexpected.join("\n")}` : "",
        stale.length > 0 ? `Stale SQL-oracle audit entries:\n${stale.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  return {
    auditedFiles: audited.length,
    behaviorBackedFiles: behaviorBacked.length,
    priorityAFiles: priorityA.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await verifyWorkerSqlTestOracles();
  console.log(
    `OK: ${result.auditedFiles} SQL-oracle test families classified (${result.priorityAFiles} priority A, ${result.behaviorBackedFiles} behavior-backed).`,
  );
}
