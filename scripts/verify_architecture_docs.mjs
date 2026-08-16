import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { markdownLinkTargets } from "./lib/markdown-links.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const documentPath = new URL(
  "../docs/architecture/arc42/08-querschnittliche-konzepte.md",
  import.meta.url,
);
const content = await readFile(documentPath, "utf8");
const requiredEvidence = [
  "## 8.1 Fachliches Domänenmodell",
  "## 8.2 Kommando-, Idempotenz- und Versionskonzept",
  "## 8.5 Prognose, Dispatch und Kapazität",
  "## 8.11 Konfigurierbarkeit ohne Deployment",
  "## 8.12 Test- und Qualitätssicherungskonzept",
  "POST /api/control/:eventId/commands",
  "GET /api/control/:eventId/operations",
  "D1-Loader → reiner Eingabe-Projector",
  "Format-2-Sicherung",
  "Nur DRAFT-Gruppen",
  "Objective-Vektor",
];

const missing = requiredEvidence.filter((entry) => !content.includes(entry));
if (missing.length > 0) {
  throw new Error(`Architekturdokumentation unvollständig: ${missing.join(", ")}`);
}

const maintainabilityPath = new URL(
  "../docs/architecture/arc42/10-qualitaetsanforderungen.md",
  import.meta.url,
);
const maintainability = `${content}\n${await readFile(maintainabilityPath, "utf8")}`;
const maintainabilityEvidence = [
  "packages/domain",
  "packages/contracts",
  "Konfigurierbarkeit ohne Deployment",
  "Architekturregeln",
  "Mutation",
  "apps/worker/src/maintainability-coverage.test.ts",
];
const missingMaintainability = maintainabilityEvidence.filter(
  (entry) => !maintainability.includes(entry),
);
if (missingMaintainability.length > 0) {
  throw new Error(`Wartbarkeitsdokumentation unvollständig: ${missingMaintainability.join(", ")}`);
}

const technicalDebtPath = new URL(
  "../docs/architecture/technical-debts/README.md",
  import.meta.url,
);
const technicalDebt = await readFile(technicalDebtPath, "utf8");
const technicalDebtEvidence = ["mutation-test-effectiveness.md"];
const missingTechnicalDebt = technicalDebtEvidence.filter(
  (entry) => !technicalDebt.includes(entry),
);
if (missingTechnicalDebt.length > 0) {
  throw new Error(
    `Technische-Schulden-Dokumentation unvollständig: ${missingTechnicalDebt.join(", ")}`,
  );
}

const technicalDebtDirectory = resolve(root, "docs/architecture/technical-debts");
for (const name of technicalDebtEvidence) {
  const debt = await readFile(resolve(technicalDebtDirectory, name), "utf8");
  for (const heading of [
    "**Status:**",
    "## Wirkung",
    "## Sicherer Abbau",
    "## Abschlusskriterium",
  ]) {
    if (!debt.includes(heading)) {
      throw new Error(`Technische Schuld ${name} enthält nicht ${heading}.`);
    }
  }
}

for (const obsolete of [
  "technical-debt-1.11.0.md",
  "technical-debt-1.12.0.md",
  "technical-debt-analysis-2026-08-10.md",
]) {
  try {
    await access(resolve(root, "docs/architecture", obsolete));
    throw new Error(`Historischer Schuldenbericht wurde nicht entfernt: ${obsolete}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Historischer")) throw error;
  }
}

const repositoryReadme = await readFile(resolve(root, "README.md"), "utf8");
if (!repositoryReadme.includes("docs/architecture/technical-debts/")) {
  throw new Error("README verweist nicht auf das aktuelle technische Schuldenregister.");
}

const privacyAcceptancePath = new URL(
  "../docs/operations/cloudflare-data-protection-acceptance-v1.md",
  import.meta.url,
);
const privacyAcceptance = await readFile(privacyAcceptancePath, "utf8");
const privacyAcceptanceEvidence = [
  "Q-DSG-040",
  "Regional Services",
  "Customer Metadata Boundary",
  "Worker-Subrequests",
  "Cloudflare Customer DPA",
  "Subprozessor",
  "Verzeichnis der Verarbeitungstätigkeiten",
  "Strenge EU-Anforderung beibehalten",
  "Anforderung formal ändern",
  "Betriebsplattform ändern",
];
const missingPrivacyAcceptance = privacyAcceptanceEvidence.filter(
  (entry) => !privacyAcceptance.includes(entry),
);
if (missingPrivacyAcceptance.length > 0) {
  throw new Error(
    `Cloudflare-Datenschutzabnahme unvollständig: ${missingPrivacyAcceptance.join(", ")}`,
  );
}

const licenseInventoryPath = new URL(
  "../docs/operations/third-party-licenses-v1.md",
  import.meta.url,
);
const licenseInventory = await readFile(licenseInventoryPath, "utf8");
const licenseInventoryEvidence = [
  "T-080",
  "@block65/custom-error",
  "RFC 8291",
  "native Web-Crypto-API",
  "externe Produktionspakete",
  "docs:licenses:check",
  "OQ-13",
];
const missingLicenseInventory = licenseInventoryEvidence.filter(
  (entry) => !licenseInventory.includes(entry),
);
if (missingLicenseInventory.length > 0) {
  throw new Error(
    `Drittanbieter-Lizenzinventar unvollständig: ${missingLicenseInventory.join(", ")}`,
  );
}

const environmentDecisionPath = new URL(
  "../docs/architecture/adr/0007-eine-cloudflare-abnahmeumgebung.md",
  import.meta.url,
);
const environmentDecision = await readFile(environmentDecisionPath, "utf8");
const environmentDecisionEvidence = [
  "T-070",
  "APP_ENV",
  "Abnahmeumgebung",
  "erfüllt T-070 nicht",
  "Verbindliches Produktions-Gate",
  "separate D1-Datenbank",
  "separater EU-R2-Bucket",
  "getrennte Secret-Sätze",
];
const missingEnvironmentDecision = environmentDecisionEvidence.filter(
  (entry) => !environmentDecision.includes(entry),
);
if (missingEnvironmentDecision.length > 0) {
  throw new Error(
    `Cloudflare-Umgebungsentscheidung unvollständig: ${missingEnvironmentDecision.join(", ")}`,
  );
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await markdownFiles(path)));
    else if (extname(entry.name) === ".md") result.push(path);
  }
  return result;
}

const currentDocuments = [
  resolve(root, "README.md"),
  resolve(root, "AGENTS.md"),
  ...(await markdownFiles(resolve(root, "docs"))),
];
const missingLinks = [];
const allowedHistoricalTombstones = new Set([
  "docs/architecture/technical-debts/assessment-2026-08-16.md::web-asset-budget-headroom.md",
]);
for (const document of currentDocuments) {
  const markdown = await readFile(document, "utf8");
  for (const linkTarget of markdownLinkTargets(markdown)) {
    const target = linkTarget.trim().replace(/^<|>$/g, "").split("#", 1)[0];
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
    const documentKey = document.slice(root.length + 1).replaceAll("\\", "/");
    if (allowedHistoricalTombstones.has(`${documentKey}::${target}`)) continue;
    const path = target.startsWith("/")
      ? resolve(root, target.slice(1))
      : resolve(dirname(document), decodeURIComponent(target));
    try {
      await access(path);
    } catch {
      missingLinks.push(`${document.slice(root.length + 1)} -> ${target}`);
    }
  }
}
if (missingLinks.length > 0) {
  throw new Error(`Lokale Dokumentationslinks fehlen: ${missingLinks.join(", ")}`);
}

const currentRoleFiles = await markdownFiles(resolve(root, "docs/roles"));
const roleMarkdown = (
  await Promise.all(currentRoleFiles.map((path) => readFile(path, "utf8")))
).join("\n");
for (const forbidden of ["Flight Line Assist", "Flight Line Supervisor", "BOOTSTRAP_TOKEN"]) {
  if (roleMarkdown.includes(forbidden)) {
    throw new Error(`Rollenunterlagen enthalten veralteten oder sensitiven Begriff: ${forbidden}`);
  }
}
const roleImages = (await readdir(resolve(root, "docs/roles/images"))).filter((name) =>
  /\.(?:png|jpe?g|webp)$/i.test(name),
);
const orphanRoleImages = roleImages.filter((name) => !roleMarkdown.includes(`images/${name}`));
if (orphanRoleImages.length > 0) {
  throw new Error(`Verwaiste aktuelle Rollenbilder: ${orphanRoleImages.join(", ")}`);
}

const requirementsReadme = await readFile(resolve(root, "docs/requirements/README.md"), "utf8");
if (!requirementsReadme.includes("einzige aktuelle Releasefassung")) {
  throw new Error("Der aktuelle kumulative Releasekatalog ist nicht eindeutig ausgewiesen.");
}

const requirementsFiles = await readdir(resolve(root, "docs/requirements"));
const allowedVersionedRequirements = new Set([
  "requirements-v1.4.md",
  "requirements-v1.4.yaml",
  "requirements-v1.12.0.md",
  "requirements-v1.12.0.yaml",
  "traceability-v1.12.0.csv",
]);
const competingReleases = requirementsFiles.filter(
  (name) =>
    /^(?:requirements|traceability)-v\d/.test(name) && !allowedVersionedRequirements.has(name),
);
if (competingReleases.length > 0) {
  throw new Error(`Konkurrierende Releasefassungen vorhanden: ${competingReleases.join(", ")}`);
}

const currentTerminologyFiles = [
  resolve(root, "README.md"),
  resolve(root, "AGENTS.md"),
  ...(await markdownFiles(resolve(root, "docs/architecture"))),
  ...(await markdownFiles(resolve(root, "docs/operations"))),
  ...(await markdownFiles(resolve(root, "docs/roles"))),
  resolve(root, "docs/ui/v1.12.0-release-concept.md"),
  resolve(root, "docs/requirements/README.md"),
  resolve(root, "docs/requirements/requirements-summary.md"),
  resolve(root, "docs/requirements/requirements-v1.12.0.md"),
  resolve(root, "docs/requirements/open-questions.md"),
];
const currentTerminology = (
  await Promise.all(currentTerminologyFiles.map((path) => readFile(path, "utf8")))
).join("\n");
for (const forbidden of ["Flight Line Assist", "Flight Line Supervisor"]) {
  if (currentTerminology.includes(forbidden)) {
    throw new Error(`Aktuelle Dokumentation enthält veralteten Begriff: ${forbidden}`);
  }
}

console.log(
  "OK: Architektur-, Datenschutz-, Umgebungs-, Lizenz-, Link-, Rollenbild- und Releasekonsistenz dokumentiert",
);
