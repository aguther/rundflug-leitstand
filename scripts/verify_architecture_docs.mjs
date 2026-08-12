import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { markdownLinkTargets } from "./lib/markdown-links.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const documentPath = new URL(
  "../docs/architecture/domain-state-and-forecast-v1.md",
  import.meta.url,
);
const content = await readFile(documentPath, "utf8");
const requiredEvidence = [
  "Q-WAR-050",
  "## 3. Zustandsautomaten",
  "## 4. Nicht verhandelbare Invarianten und technische Sicherungen",
  "## 5. Prognoseverfahren",
  "## 6. Betreiberleitfaden",
  "## 7. Entwicklerleitfaden und Nachweise",
  "packages/domain/src/index.ts",
  "packages/domain/src/forecast.ts",
  "packages/domain/src/capacity.ts",
  "packages/domain/src/queue.ts",
  "apps/worker/src/event-coordinator.ts",
  "npm run check",
];

const missing = requiredEvidence.filter((entry) => !content.includes(entry));
if (missing.length > 0) {
  throw new Error(`Architekturdokumentation unvollständig: ${missing.join(", ")}`);
}

const maintainabilityPath = new URL(
  "../docs/architecture/maintainability-and-extension-v1.md",
  import.meta.url,
);
const maintainability = await readFile(maintainabilityPath, "utf8");
const maintainabilityEvidence = [
  "Q-WAR-010",
  "Q-WAR-020",
  "Q-WAR-040",
  "packages/domain",
  "packages/contracts",
  "Abhängigkeits-Allowlist",
  "Adapter",
  "apps/worker/src/maintainability-coverage.test.ts",
];
const missingMaintainability = maintainabilityEvidence.filter(
  (entry) => !maintainability.includes(entry),
);
if (missingMaintainability.length > 0) {
  throw new Error(`Wartbarkeitsdokumentation unvollständig: ${missingMaintainability.join(", ")}`);
}

const technicalDebtPath = new URL("../docs/architecture/technical-debt-1.12.0.md", import.meta.url);
const technicalDebt = await readFile(technicalDebtPath, "utf8");
const technicalDebtEvidence = [
  "Technische Schulden – Stand 1.12.0",
  "1.394 Zeilen",
  "219 Zeilen",
  "663 Zeilen",
  "135",
  "D1Database.batch()",
  "npm audit --omit=dev",
  "npm run refactor:guardrails",
  "scripts/verify_web_assets.mjs",
  "apps/web/src/app/realtime-refresh-scheduler.ts",
  "20 operative",
  "50 öffentliche",
];
const missingTechnicalDebt = technicalDebtEvidence.filter(
  (entry) => !technicalDebt.includes(entry),
);
if (missingTechnicalDebt.length > 0) {
  throw new Error(
    `Technische-Schulden-Dokumentation unvollständig: ${missingTechnicalDebt.join(", ")}`,
  );
}

const repositoryReadme = await readFile(resolve(root, "README.md"), "utf8");
if (!repositoryReadme.includes("technical-debt-1.12.0.md")) {
  throw new Error("README verweist nicht auf den aktuellen technischen Schuldenstand 1.12.0.");
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
  "../docs/adr/0007-eine-cloudflare-abnahmeumgebung.md",
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
for (const document of currentDocuments) {
  const markdown = await readFile(document, "utf8");
  for (const linkTarget of markdownLinkTargets(markdown)) {
    const target = linkTarget.trim().replace(/^<|>$/g, "").split("#", 1)[0];
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
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
