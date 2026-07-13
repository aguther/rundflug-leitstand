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

console.log("OK: Q-WAR-050 Fachmodell, Zustandsautomaten und Prognose dokumentiert");
