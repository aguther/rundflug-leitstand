# Verifikationsnachweis: Forecast-Pipeline-Modularisierung

Stand: 2026-08-12
Historischer Ursprung: AP-12 der inzwischen entfernten, datierten Schuldenanalyse. Der noch offene
Legacy-Anteil wird unter
`docs/architecture/technical-debts/forecast-legacy-comparison-path.md` fortgeführt.

## Nachgewiesene Struktur

- Der Worker-Orchestrator besitzt keine D1-Abfragen und keine fachlichen Projektionsregeln mehr.
- Laden, reine Normalisierung, Voraufrufauswahl, Persistenz und Veröffentlichung liegen in getrennten
  Modulen.
- Die Domain ist nach Typen, Sampling, Verfügbarkeit, Projektion und Diagnostik getrennt;
  `forecast.ts` ist eine fünfzeilige kompatible Exportfassade.
- Ratchets erfassen jedes neue Produktionsmodul und verhindern eine Rückkehr zum 1.479-zeiligen
  Worker-Service.
- ADR-0041 dokumentiert Reihenfolge, Persist-before-publish und das überprüfbare Abschaltkriterium
  des privaten Legacy-Vergleichspfads.

## Gezielte Regressionstests

`apps/worker/src/forecast-pipeline-modules.test.ts` prüft:

1. Ablehnung einer stale Event-Version an der Loader-Grenze;
2. Cloudflare-unabhängige Projektion eines leeren normalisierten Datensatzes mit expliziter Zeit;
3. automatische Voraufrufe nur mit frischer Dispatch-Revision und Batch;
4. Fail-fast bei fehlender Rotation-Projektion;
5. Isolation fehlerhafter WebSockets und geplante Slowdown-Folgeläufe;
6. wirkungsfreie leere Repository-Persistenz.

Die bestehende Domain-Suite `packages/domain/src/forecast.test.ts` bleibt unverändert grün und prüft
damit die öffentliche Kompatibilitätsfassade sowie die bisherigen Forecast-Ergebnisse.

## Abschlussprüfungen

Vor Integration werden mindestens ausgeführt und im Abschlussbericht mit dem exakten Commitstand
belegt:

- gezielte Forecast-Tests;
- `npm run test:coverage`;
- `npm run docs:arc42:check`, `npm run docs:verify` und wegen der geänderten arc42-Bausteinsicht
  `npm run docs:arc42:pdf` mit visueller Prüfung;
- vollständiges `npm run check` einschließlich V1-Core-Integration, Acceptance Day, Restore,
  Skalierungs- und Anforderungsnachweisen.
