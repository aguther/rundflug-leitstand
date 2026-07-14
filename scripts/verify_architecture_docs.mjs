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

console.log(
  "OK: Q-WAR-010/020/040/050 Fachmodell, Grenzen, Konfiguration und Prognose dokumentiert",
);
