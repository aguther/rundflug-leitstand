import { readFile } from "node:fs/promises";

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
  "nativen Web-Crypto-API",
  "27 unter MIT und 6 unter ISC",
  "Nutzungsrecht, Lizenztext und Übergabeprotokoll",
];
const missingLicenseInventory = licenseInventoryEvidence.filter(
  (entry) => !licenseInventory.includes(entry),
);
if (missingLicenseInventory.length > 0) {
  throw new Error(
    `Drittanbieter-Lizenzinventar unvollständig: ${missingLicenseInventory.join(", ")}`,
  );
}

console.log(
  "OK: Q-WAR-010/020/040/050, Q-DSG-040 und T-080 Betriebs-, Fachmodell-, Datenschutz- und Lizenznachweise dokumentiert",
);
