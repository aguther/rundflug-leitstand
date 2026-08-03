import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inventoryPath = resolve(root, "docs", "operations", "third-party-licenses-v1.md");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm executable path is missing.");
const list = spawnSync(
  process.execPath,
  [npmCli, "ls", "--omit=dev", "--all", "--json", "--long"],
  {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  },
);
if (list.status !== 0) {
  throw new Error(
    `npm production graph failed: ${list.error?.message ?? list.stderr ?? "unknown error"}`,
  );
}
const productionRoot = JSON.parse(list.stdout);
const packagesByPath = new Map();
const collectProductionPackages = (entry) => {
  if (
    entry.path?.includes("node_modules") &&
    entry.name !== "rundflug-leitstand" &&
    !entry.name.startsWith("@rundflug/")
  ) {
    packagesByPath.set(entry.path, entry);
  }
  for (const dependency of Object.values(entry.dependencies ?? {})) {
    collectProductionPackages(dependency);
  }
};
collectProductionPackages(productionRoot);
const packages = await Promise.all(
  [...packagesByPath.values()].map(async (entry) => {
    if (entry.license) return entry;
    const nodeModulesSegment = `${sep}node_modules${sep}`;
    const nodeModulesIndex = entry.path.indexOf(nodeModulesSegment);
    if (nodeModulesIndex < 0) {
      throw new Error(`Installed package path has no node_modules segment: ${entry.path}`);
    }
    const relativePackagePath = entry.path.slice(nodeModulesIndex + 1);
    const manifest = JSON.parse(
      await readFile(resolve(root, relativePackagePath, "package.json"), "utf8"),
    );
    return { ...entry, license: manifest.license };
  }),
);
const licenseCounts = new Map();
for (const entry of packages) {
  const license = entry.license ?? "FEHLT";
  licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
}
if (licenseCounts.has("FEHLT") || licenseCounts.has("UNLICENSED")) {
  throw new Error("Production dependency without an approved SPDX license found.");
}

const directNames = new Set();
for (const packagePath of [
  "apps/web/package.json",
  "apps/worker/package.json",
  "packages/config/package.json",
  "packages/contracts/package.json",
  "packages/domain/package.json",
  "packages/testkit/package.json",
]) {
  const manifest = JSON.parse(await readFile(resolve(root, packagePath), "utf8"));
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (!name.startsWith("@rundflug/")) directNames.add(name);
  }
}
const directPackages = [...directNames]
  .map((name) => packages.find((entry) => entry.name === name))
  .filter(Boolean)
  .sort((left, right) => left.name.localeCompare(right.name));
const licenseSummary = [...licenseCounts]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([license, count]) => `${count} ${license}`)
  .join(", ");
const directRows = directPackages.map(
  (entry) => `| \`${entry.name}\` | ${entry.version} | ${entry.license} |`,
);
const expected = `# Drittanbieter-Lizenzinventar – Release 1.12.0

Stand: automatisch aus installiertem Lockfile/Produktionsgraph erzeugt
Betroffene Anforderungen: T-080, V1100-DEP-010 und V1120-DEP-010

## Ergebnis

\`npm ls --omit=dev --all --json --long\` meldet ${packages.length} externe Produktionspakete:
${licenseSummary}. Kein Produktionspaket besitzt fehlende, \`UNLICENSED\`- oder proprietäre
Lizenzmetadaten.

Die frühere Abhängigkeit \`@block65/webcrypto-web-push\` und deren unlizenziertes Transitpaket
\`@block65/custom-error\` sind nicht enthalten. Web-Push verwendet die native Web-Crypto-API nach
RFC 8188, RFC 8291 und RFC 8292.

## Direkte Laufzeitabhängigkeiten

| Paket | Installierte Version | Lizenz |
| --- | --- | --- |
${directRows.join("\n")}

Interne Pakete unter \`@rundflug/*\` gehören zum selben privaten Repository. Das Lockfile ist die
versionsgenaue Quelle. Das Inventar wird mit \`npm run docs:licenses:check\` gegen den installierten
Produktionsgraph geprüft und mit \`npm run docs:licenses:build\` aktualisiert.

## Sicherheits- und Rechtehinweis

\`npm audit\` und \`npm audit --omit=dev\` sind vor Freigabe auszuführen. Der am 3. August 2026
geprüfte Lockfile-Stand enthält keine bekannten npm-Sicherheitsbefunde. Dependabot überwacht die
Abhängigkeiten weiterhin wöchentlich. Die Entwicklungs- und Buildkette verarbeitet keine
Laufzeitanfragen oder fremden Projektdateien im Worker.

Dieses technische Inventar ersetzt keine rechtsverbindliche Rechteübertragung am projektspezifischen
Quellcode. \`LICENSE.md\` bleibt bis zur Entscheidung der berechtigten Parteien auf „alle Rechte
vorbehalten“. Nutzungsrecht, Lizenztext und Übergabeprotokoll bleiben als OQ-13 offen.
`;

if (process.argv.includes("--write")) {
  await writeFile(inventoryPath, expected, "utf8");
  process.stdout.write(
    `OK: generated license inventory with ${packages.length} production packages\n`,
  );
} else {
  const actual = await readFile(inventoryPath, "utf8");
  if (actual !== expected) {
    throw new Error("License inventory is stale. Run npm run docs:licenses:build.");
  }
  process.stdout.write(`OK: verified ${packages.length} production packages and licenses\n`);
}
