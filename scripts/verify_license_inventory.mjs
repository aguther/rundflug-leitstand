import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inventoryPath = resolve(root, "docs", "operations", "third-party-licenses-v1.md");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
const query = spawnSync(process.execPath, [npmCli, "query", ":not(.dev)", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
});
if (query.status !== 0) {
  throw new Error(
    `npm query fehlgeschlagen: ${query.error?.message ?? query.stderr ?? "unbekannt"}`,
  );
}
const packages = JSON.parse(query.stdout).filter(
  (entry) =>
    entry.name !== "rundflug-leitstand" &&
    !entry.name.startsWith("@rundflug/") &&
    entry.location?.includes("node_modules"),
);
const licenseCounts = new Map();
for (const entry of packages) {
  const license = entry.license ?? "FEHLT";
  licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
}
if (licenseCounts.has("FEHLT") || licenseCounts.has("UNLICENSED")) {
  throw new Error("Produktionsabhängigkeit ohne freigegebene SPDX-Lizenz gefunden.");
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
const expected = `# Drittanbieter-Lizenzinventar – Release 1.10.0

Stand: automatisch aus installiertem Lockfile/Produktionsgraph erzeugt
Betroffene Anforderung: T-080 und V1100-DEP-010

## Ergebnis

\`npm query ':not(.dev)' --json\` meldet ${packages.length} externe Produktionspakete:
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

\`npm audit --omit=dev\` ist vor Freigabe auszuführen. Der am 26. Juli 2026 verbleibende npm-Befund
betrifft ausschließlich die Buildkette von \`vite-plugin-pwa\`/Workbox; es gibt derzeit keine mit
Vite 8 kompatible gefixte Upstreamversion. Dependabot überwacht die Kette wöchentlich. Sie verarbeitet
keine Laufzeitanfragen oder fremden Projektdateien im Worker.

Dieses technische Inventar ersetzt keine rechtsverbindliche Rechteübertragung am projektspezifischen
Quellcode. \`LICENSE.md\` bleibt bis zur Entscheidung der berechtigten Parteien auf „alle Rechte
vorbehalten“. Nutzungsrecht, Lizenztext und Übergabeprotokoll bleiben als OQ-13 offen.
`;

if (process.argv.includes("--write")) {
  await writeFile(inventoryPath, expected, "utf8");
  process.stdout.write(`OK: Lizenzinventar mit ${packages.length} Produktionspaketen erzeugt\n`);
} else {
  const actual = await readFile(inventoryPath, "utf8");
  if (actual !== expected) {
    throw new Error("Lizenzinventar ist veraltet. Führe npm run docs:licenses:build aus.");
  }
  process.stdout.write(`OK: ${packages.length} Produktionspakete und Lizenzmetadaten geprüft\n`);
}
