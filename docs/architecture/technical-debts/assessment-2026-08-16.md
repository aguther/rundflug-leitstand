# Neubewertung der historischen Schuldenberichte

- **Prüfdatum:** 16. August 2026
- **Geprüfte Berichte:** `technical-debt-1.11.0.md`, `technical-debt-1.12.0.md` und
  `technical-debt-analysis-2026-08-10.md`
- **Prüfbasis:** aktueller Quellstand, Größenratchets, Verhaltens- und Architekturtests, CI-Workflow,
  ADRs und aktuelle Verifikationsnachweise

Die drei Eingangsberichte waren zeitgebundene Bestandsaufnahmen. Sie wurden nach dieser Prüfung
entfernt, damit erledigte Befunde nicht weiter als aktueller Architekturstand erscheinen. Noch
gültige Themen werden ausschließlich in den verlinkten eigenständigen Schuldendokumenten gepflegt.

## Fortgeltende Befunde

| Historischer Befund | Aktuelle Einordnung |
| --- | --- |
| Komplexe Stammdaten- und Operations-Orchestrierung | [fortgeltend](worker-orchestration-complexity.md); die aktuellen Schwerpunkte sind `master-data-command-service.ts`, `operations-read-service.ts` und `operations-routes.ts` |
| Geringer Abstand einzelner Web-Assets zu den Budgets | [fortgeltend](web-asset-budget-headroom.md); die manifestbasierten Zwei-Prozent-Ratchets bleiben notwendig |
| Paralleler Forecast-Legacy-Pfad | behoben durch ADR-0054; `calculateLegacyForecastTimelines` und sein DRAFT-Overlay sind entfernt |
| Unzureichende Aussagekraft einzelner Tests | in vier Messfragen getrennt: Quelltextorakel sind behoben, Coverage ist geratcheted, [Mutationstest-Aussagekraft](mutation-test-effectiveness.md) und die elf priorisierten [Worker-SQL-Testorakel](worker-sql-test-oracles.md) bleiben als unabhängige Schulden offen |

## Behobene oder nicht fortgeführte Befunde

| Historischer Befund | Aktueller Nachweis und Einordnung |
| --- | --- |
| Große Kassen- und Flight-Line-Komponenten | behoben; `CashierWorkspace.tsx` besitzt 228 und `FlightLineWorkspace.tsx` 466 logische Zeilen, neu extrahierte Komponenten und Hooks bleiben unter 300 Zeilen und werden durch fallende Größenratchets geschützt |
| Monolithischer Event Coordinator und Ticketverkauf | behoben; `event-coordinator.ts` umfasst 721 Zeilen, der Verkauf liegt in `ticket-sales-command-service.ts` |
| Monolithischer Forecast-Worker-Adapter | behoben; `forecast-timeline-service.ts` umfasst 117 Zeilen und delegiert an die dokumentierte Pipeline; nur der getrennt geführte Legacy-Vergleich bleibt offen |
| Große Worker-, Admin- und Contracts-Einstiege | behoben; `apps/worker/src/index.ts` umfasst 195, `admin-view.tsx` 656 und der Contracts-Root-Barrel acht Zeilen |
| Clientseitig wählbare öffentliche Codes | behoben; der Contract weist Clientcodes zurück und `public-code-service.ts` vergibt kollisionsgeprüfte Codes im Worker |
| Vollständig gepufferte portable Sicherung | behoben; Format 2 verwendet seitenweises Lesen, NDJSON, inkrementelle Hashes und R2-Multipart; der Skalierungstest prüft begrenzte Seitengrößen und Uploadteile |
| Fehlende React-Fehlergrenzen | behoben; Anwendung und Rollenrouten verwenden `AppErrorBoundary` mit DOM- und Browsernachweisen |
| Unvollständige Coverage- und PR-Gates | behoben; Vitest besitzt eine Produktions-`coverage.include`, die PR-CI führt Worker-Runtime-, V1-Integrations- und Dokumentationsprüfungen aus und wartet auf das Sonar-Quality-Gate |
| Unisolierte lokale Verifier | behoben; das gemeinsame Harness und die Familienverträge werden durch ADR-0043 und automatisierte Prüfungen abgesichert |
| Doppelte Simulationsprimitive und monolithische Engines | behoben; ADR-0042 und die modulare Simulationspipeline sichern gemeinsame deterministische Primitive und phasenbezogene Tests |
| Breiter Importzeit-Veranstaltungskontext | behoben; `operation-workspace.tsx` ist eine 13-zeilige kompatible Exportfassade, der Laufzeitkontext liegt in den geschnittenen App-Modulen |
| Produktions-Quelltexttests über `?raw` | behoben; Availability-, Soak- und Remote-Performance-Prüfungen führen importierte Policy-/Szenariomodule mit injizierten Uhr-, Prozess-, HTTP-, Probe- und WebSocket-Adaptern aus. Der Guardrail meldet null Rohimporte oder Dateilesezugriffe auf Produktionslogik in `.ts`, `.tsx`, `.js` und `.mjs` sowie null literale Python-Zugriffe; Konfiguration, Dokumentation, Manifeste und statische Artefakte bleiben zulässige Dateiverträge |
| Historische doppelte Migrationsnummer | durch die inkompatible V1.12-Baseline abgelöst; die eindeutige aktuelle Baseline und ihr Wiederaufbau sind in ADR-0045 und ADR-0049 festgelegt |

## Bewusste Entscheidungen statt technischer Schuld

Die Online-Pflicht operativer Kommandos und der Administration, die getrennten Reset-, Archiv- und
Löschpfade sowie der inkompatible D1-Baseline-Neuaufbau sind bewusst akzeptierte
Architekturentscheidungen. Ihre Folgen werden in arc42, Betriebsdokumentation und ADRs geführt, nicht
als aufzulösende technische Schuld.
