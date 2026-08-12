# SonarQube-Issue-Triage vom 12. August 2026

## Zweck und Messbasis

Diese Datei ist das versionierte Arbeitsinventar für die bewertungsbasierte Qualitätskampagne. Sie
wurde aus dem SonarQube-MCP-Stand des Branches `main` mit Analysezeitpunkt
`2026-08-12T13:19:37Z` erzeugt. Die getrennten Severity-Abfragen ergaben 778 offene oder
bestätigte Issues: 0 Blocker, 78 High, 447 Medium und 253 Low. Zusätzlich waren 60 Issues der
Softwarequalität Reliability und 740 der Softwarequalität Maintainability zugeordnet; ein Issue
kann mehrere Qualitäten beeinflussen.

Die kombinierte MCP-Abfrage aller Severities meldete abweichend nur 762 Code-Smell-Datensätze.
Deshalb verwendet dieses Inventar die getrennten Severity-Abfragen als nachprüfbare Messbasis und
bewahrt die Serverdifferenz ausdrücklich auf, statt 16 Findings stillschweigend zu verlieren.

`PENDING` bedeutet ausdrücklich, dass noch keine technische Bewertung oder Serveraktion erfolgt
ist. Ein Eintrag darf erst nach Prüfung des konkreten Codes auf `FIX`, `ARCHITECTURE_BACKLOG`,
`FALSE_POSITIVE`, `ACCEPTED` oder `ROOT_CAUSE` geändert werden.

## Bewertungs- und Serverregeln

- `FIX`: reales Problem; Regressionstest und Codeänderung, Abschluss erst nach neuem Scan.
- `ARCHITECTURE_BACKLOG`: reales Problem, aber kein sicherer lokaler Fix; bleibt offen mit
  konkretem Folgepaket.
- `FALSE_POSITIVE`: Regelannahme objektiv unzutreffend; Sonar-Status und Serverkommentar erforderlich.
- `ACCEPTED`: formal berechtigt, Änderung wäre unverhältnismäßig oder schädlich; Sonar-Status,
  Kommentar und Neubewertungsauslöser erforderlich.
- `ROOT_CAUSE`: wird durch einen gemeinsamen Ursachenfix geschlossen.
- Ohne Berechtigung für einen dauerhaften Sonar-Kommentar erfolgt kein Statuswechsel.

## Analysewarnungen und Bewertung

Der CI-Scannerlog des Laufs `31600607959` wurde bis auf Dateiebene geprüft:

| Warnung | Bewertung | Maßnahme |
| --- | --- | --- |
| Python-Version nicht festgelegt | berechtigter Konfigurationsbefund | `sonar.python.version=3.13` entsprechend der CI-Laufzeit |
| PNG-Dateien als UTF-8 gelesen | Scanner-Scope-Fehlklassifikation binärer PWA-Assets | nur `apps/web/public/**/*.png` aus der Quelltextanalyse nehmen; Anwendungsquellen und Coverage bleiben unverändert |
| PL/SQL-Data-Dictionary fehlt und SQLite-Syntax ist nicht parsebar | falscher Analyzer für 69 erkannte SQLite-Dateien | `.sql` aus der Oracle-PL/SQL-Suffixliste entfernen; D1-Migrations-, Restore- und Integrationstests bleiben maßgeblich |

Der Scanner erkannte selbst 69 Dateien als SQLite und zwei als ANSI SQL. Ein Oracle Data Dictionary
würde die Analyse daher nicht präzisieren, sondern eine fachlich falsche Datenbankannahme einführen.
Alle als Quelltext behandelten Dateien unter `apps`, `packages` und `scripts` werden zusätzlich
durch einen UTF-8-Guard geprüft.

## High-Issues – Einzelbewertung erforderlich

| Issue-Key | Severity | Qualität | Regel | Fundstelle | Problem | Klassifikation | Technische Relevanz / Begründung | Änderungsrisiko | Testnachweis | Serveraktion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AZ_l6CqULlJq96xp0ceN | High | Maintainability | typescript:S3776 | `apps/web/src/admin-view.tsx:60` | Refactor this function to reduce its Cognitive Complexity from 42 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6ClkLlJq96xp0ccm | High | Maintainability | typescript:S3776 | `apps/web/src/app/AppHeader.tsx:66` | Refactor this function to reduce its Cognitive Complexity from 54 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CoqLlJq96xp0cda | High | Maintainability | typescript:S3776 | `apps/web/src/cashier-view.tsx:105` | Refactor this function to reduce its Cognitive Complexity from 33 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CoqLlJq96xp0cdc | High | Maintainability | typescript:S3776 | `apps/web/src/cashier-view.tsx:263` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CoqLlJq96xp0cde | High | Maintainability | typescript:S3776 | `apps/web/src/cashier-view.tsx:689` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CfyLlJq96xp0cao | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/aircraft/AircraftResourceGroupAssignmentDialog.tsx:10` | Refactor this function to reduce its Cognitive Complexity from 23 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_qaANiYdlOTNJd7e6e | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/completion/CompletionHistoryPanel.tsx:76` | Refactor this function to reduce its Cognitive Complexity from 28 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_qaAJKYdlOTNJd7e6d | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/completion/useAdminHistory.ts:99` | Refactor this function to reduce its Cognitive Complexity from 22 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_qKPdw7-uFVRMCVg5G | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/event-workspace/EventCatalogDialog.tsx:62` | Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_q8ZgBjAxtp6gqKeqK | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/master-data/AdminMasterDataWorkspacePanel.tsx:38` | Refactor this function to reduce its Cognitive Complexity from 24 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_qwYPSnhynfjhWO1p7 | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/master-data/AdminMasterEditorActions.tsx:40` | Refactor this function to reduce its Cognitive Complexity from 42 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_q8Zi7jAxtp6gqKeqM | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/master-data/useAdminMasterDataActions.ts:622` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_q8Zi7jAxtp6gqKeqR | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/master-data/useAdminMasterDataActions.ts:643` | Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_qwYPinhynfjhWO1qI | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/master-data/useAdminMasterDataDeletion.ts:24` | Refactor this function to reduce its Cognitive Complexity from 27 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_qwYM1nhynfjhWO1pg | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/master-data/useAdminMasterDataTable.ts:72` | Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_qwYM1nhynfjhWO1ps | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/master-data/useAdminMasterDataTable.ts:162` | Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_qaAPCYdlOTNJd7e6i | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/operations/AdminOperationsPanel.tsx:30` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_qRD1vLqw2KI1-RGKq | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/overview/AdminAccessStatusBar.tsx:17` | Refactor this function to reduce its Cognitive Complexity from 24 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_qCmOEluG7EYJBfPS_ | High | Maintainability | typescript:S3776 | `apps/web/src/features/admin/products/ProductEditorDialog.tsx:24` | Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CkmLlJq96xp0ccH | High | Maintainability | typescript:S3776 | `apps/web/src/features/flight-line/FlightDirectorAnalyticsContent.tsx:197` | Refactor this function to reduce its Cognitive Complexity from 48 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CkmLlJq96xp0ccO | High | Maintainability | typescript:S3776 | `apps/web/src/features/flight-line/FlightDirectorAnalyticsContent.tsx:661` | Refactor this function to reduce its Cognitive Complexity from 25 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cj1LlJq96xp0cbh | High | Maintainability | typescript:S3776 | `apps/web/src/features/flight-line/FlightDirectorOperationsDialog.tsx:114` | Refactor this function to reduce its Cognitive Complexity from 44 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CeJLlJq96xp0caD | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/csv-calibration.ts:83` | Refactor this function to reduce its Cognitive Complexity from 19 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CeJLlJq96xp0caE | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/csv-calibration.ts:192` | Refactor this function to reduce its Cognitive Complexity from 41 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CdCLlJq96xp0cZS | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/ForecastSimulationView.tsx:288` | Refactor this function to reduce its Cognitive Complexity from 23 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CdYLlJq96xp0cZf | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/ForecastTimeline.tsx:187` | Refactor this function to reduce its Cognitive Complexity from 19 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_0hwMxR1I9WvIHxPKC | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/legacy-simulation-dispatch.ts:20` | Refactor this function to reduce its Cognitive Complexity from 31 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_0hwPMR1I9WvIHxPKF | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/legacy-simulation-lifecycle.ts:28` | Refactor this function to reduce its Cognitive Complexity from 65 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CcQLlJq96xp0cZC | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/model.ts:694` | Refactor this function to reduce its Cognitive Complexity from 165 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_0hwLjR1I9WvIHxPJ5 | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/operational-simulation-lifecycle.ts:19` | Refactor this function to reduce its Cognitive Complexity from 107 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_0hwLRR1I9WvIHxPJ4 | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/operational-simulation-scenario.ts:98` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_0hwJCR1I9WvIHxPJ3 | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/simulation-metrics.ts:79` | Refactor this function to reduce its Cognitive Complexity from 77 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CeALlJq96xp0cZ- | High | Maintainability | typescript:S3776 | `apps/web/src/features/forecast-simulation/SimulationFoundationDialog.tsx:65` | Refactor this function to reduce its Cognitive Complexity from 38 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CkzLlJq96xp0ccX | High | Maintainability | typescript:S3776 | `apps/web/src/features/operations/OperationalPlanPanel.tsx:90` | Refactor this function to reduce its Cognitive Complexity from 40 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Ce1LlJq96xp0cad | High | Maintainability | typescript:S3776 | `apps/web/src/features/public-status/use-public-push.ts:123` | Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CqhLlJq96xp0cfq | High | Maintainability | typescript:S3776 | `apps/web/src/fids-display.tsx:304` | Refactor this function to reduce its Cognitive Complexity from 26 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cq_LlJq96xp0cf5 | High | Maintainability | typescript:S3776 | `apps/web/src/flight-line-assist.tsx:66` | Refactor this function to reduce its Cognitive Complexity from 23 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CreLlJq96xp0cgY | High | Maintainability | typescript:S3776 | `apps/web/src/flight-line-shared.tsx:261` | Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CreLlJq96xp0cgk | High | Maintainability | typescript:S3776 | `apps/web/src/flight-line-shared.tsx:512` | Refactor this function to reduce its Cognitive Complexity from 71 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CrQLlJq96xp0cf7 | High | Maintainability | typescript:S3776 | `apps/web/src/flight-line-view.tsx:80` | Refactor this function to reduce its Cognitive Complexity from 115 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CrQLlJq96xp0cgB | High | Maintainability | typescript:S3776 | `apps/web/src/flight-line-view.tsx:250` | Refactor this function to reduce its Cognitive Complexity from 30 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CrRLlJq96xp0cgF | High | Maintainability | typescript:S3776 | `apps/web/src/flight-line-view.tsx:878` | Refactor this function to reduce its Cognitive Complexity from 31 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_oPiVYMZUky4BdXok0 | High | Maintainability | typescript:S3776 | `apps/worker/src/admin-event-deletion-service.ts:66` | Refactor this function to reduce its Cognitive Complexity from 33 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_n-KulycsaNSwwUGRO | High | Maintainability | typescript:S3776 | `apps/worker/src/admin-master-data-template-routes.ts:184` | Refactor this function to reduce its Cognitive Complexity from 31 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_ok5wVA1Estd7HihpD | High | Maintainability | typescript:S3776 | `apps/worker/src/analysis-control-routes.ts:59` | Refactor this function to reduce its Cognitive Complexity from 36 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_ok5wVA1Estd7HihpI | High | Maintainability | typescript:S3776 | `apps/worker/src/analysis-control-routes.ts:281` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_mPxisZ8Hac6hzcA1u | High | Maintainability | typescript:S3776 | `apps/worker/src/analysis-snapshot-capture-service.ts:61` | Refactor this function to reduce its Cognitive Complexity from 24 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CawLlJq96xp0cYY | High | Maintainability | typescript:S3776 | `apps/worker/src/analysis-snapshot.ts:176` | Refactor this function to reduce its Cognitive Complexity from 22 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_nW6vjXLQn_jWP8KX_ | High | Maintainability | typescript:S3776 | `apps/worker/src/auth-routes.ts:52` | Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CYWLlJq96xp0cXX | High | Maintainability | typescript:S3776 | `apps/worker/src/dispatch-recommendation-lease-service.ts:273` | Refactor this function to reduce its Cognitive Complexity from 47 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CaGLlJq96xp0cX0 | High | Maintainability | typescript:S3776 | `apps/worker/src/event-coordinator.ts:520` | Refactor this function to reduce its Cognitive Complexity from 36 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_nykgrXLQn_jWP_PRR | High | Maintainability | typescript:S3776 | `apps/worker/src/factory-reset-routes.ts:55` | Refactor this function to reduce its Cognitive Complexity from 23 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CYiLlJq96xp0cXZ | High | Maintainability | typescript:S3776 | `apps/worker/src/fleet-administration-command-service.ts:24` | Refactor this function to reduce its Cognitive Complexity from 106 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_0vUisxILwZHPZZnut | High | Maintainability | typescript:S3776 | `apps/worker/src/forecast-timeline-projector.ts:25` | Refactor this function to reduce its Cognitive Complexity from 19 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CYHLlJq96xp0cXN | High | Maintainability | typescript:S3776 | `apps/worker/src/master-data-command-service.ts:24` | Refactor this function to reduce its Cognitive Complexity from 27 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CYHLlJq96xp0cXO | High | Maintainability | typescript:S3776 | `apps/worker/src/master-data-command-service.ts:610` | Refactor this function to reduce its Cognitive Complexity from 45 to the 15 allowed. | FIX | Berechtigter Befund: Entitätsauflösung, Referenzprüfung und Persistenz lagen in einem 200-Zeilen-Zweig. Die Löschplanung wurde als eigene fachliche Verantwortung extrahiert; der Command-Service behält Phasenprüfung, atomare Persistenz, Audit, Idempotenz und Broadcast. | Mittel; Fehlercodes, Blockertexte und Statement-Reihenfolge mussten unverändert bleiben. | `master-data-command-service.test.ts`: alle sechs Entitätstypen, Mehrfachblocker, Phasensperre, Audit/Receipt/Outbox; lokaler Sonar-Dateiscan ohne S3776 in `master-data-deletion.ts`. | Folgescan muss schließen |
| AZ_l6CYHLlJq96xp0cXQ | High | Maintainability | typescript:S3776 | `apps/worker/src/master-data-command-service.ts:891` | Refactor this function to reduce its Cognitive Complexity from 68 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_pID3-TmPyO1xhSKnR | High | Maintainability | typescript:S3776 | `apps/worker/src/operations-routes.ts:585` | Refactor this function to reduce its Cognitive Complexity from 25 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_mOVkfIdg5QZyC966P | High | Maintainability | typescript:S3776 | `apps/worker/src/outage-recovery-command-service.ts:35` | Refactor this function to reduce its Cognitive Complexity from 87 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CamLlJq96xp0cYJ | High | Maintainability | typescript:S3776 | `apps/worker/src/planned-operation-command-service.ts:25` | Refactor this function to reduce its Cognitive Complexity from 89 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_nDclgaa4LEs-MCg0B | High | Maintainability | typescript:S3776 | `apps/worker/src/public-status-routes.ts:130` | Refactor this function to reduce its Cognitive Complexity from 19 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CacLlJq96xp0cYF | High | Maintainability | typescript:S3776 | `apps/worker/src/recurring-operational-rule-command-service.ts:20` | Refactor this function to reduce its Cognitive Complexity from 43 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_mYLISMZUky4BdP8BY | High | Maintainability | typescript:S3776 | `apps/worker/src/rotation-transition-command-service.ts:59` | Refactor this function to reduce its Cognitive Complexity from 102 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CYtLlJq96xp0cXc | High | Maintainability | typescript:S3776 | `apps/worker/src/ticket-group-mutation-command-service.ts:36` | Refactor this function to reduce its Cognitive Complexity from 32 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_yzGffrVS8B668Tqoy | High | Maintainability | typescript:S3776 | `apps/worker/src/ticket-sales-command-service.ts:26` | Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_0vVwyxILwZHPZZnuw | High | Maintainability | typescript:S3776 | `packages/domain/src/forecast-projection.ts:202` | Refactor this function to reduce its Cognitive Complexity from 35 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_0vVwyxILwZHPZZnuy | High | Maintainability | typescript:S3776 | `packages/domain/src/forecast-projection.ts:501` | Refactor this function to reduce its Cognitive Complexity from 55 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_0vVwyxILwZHPZZnu0 | High | Maintainability | typescript:S3776 | `packages/domain/src/forecast-projection.ts:940` | Refactor this function to reduce its Cognitive Complexity from 23 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvunAHB_X69K2orHv | High | Maintainability | javascript:S3776 | `scripts/arc42_markdown_to_html.mjs:89` | Refactor this function to reduce its Cognitive Complexity from 42 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_1ZuXs6Zn-jKkXr0lU | High | Maintainability | javascript:S3776 | `scripts/lib/worker-test-harness.mjs:83` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6C0HLlJq96xp0cjQ | High | Maintainability | javascript:S3776 | `scripts/replay_analysis_package.mjs:80` | Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6C0HLlJq96xp0cjT | High | Maintainability | javascript:S3776 | `scripts/replay_analysis_package.mjs:342` | Refactor this function to reduce its Cognitive Complexity from 40 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6C0HLlJq96xp0cjV | High | Maintainability | javascript:S3776 | `scripts/replay_analysis_package.mjs:432` | Refactor this function to reduce its Cognitive Complexity from 25 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6C0HLlJq96xp0cjW | High | Maintainability | javascript:S3776 | `scripts/replay_analysis_package.mjs:542` | Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvup0HB_X69K2orHz | High | Maintainability | javascript:S3776 | `scripts/verify_arc42_docs.mjs:56` | Refactor this function to reduce its Cognitive Complexity from 35 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CzkLlJq96xp0cjI | High | Maintainability | javascript:S3776 | `scripts/verify_cashier_browser.mjs:339` | Refactor this function to reduce its Cognitive Complexity from 24 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cw2LlJq96xp0cim | High | Maintainability | python:S3776 | `scripts/verify_requirements.py:85` | Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CzsLlJq96xp0cjK | High | Maintainability | python:S3776 | `scripts/verify_role_guides.py:17` | Refactor this function to reduce its Cognitive Complexity from 30 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |

## Reliability-Issues – technische Einzelbewertung

Alle 60 Reliability-Issues wurden am konkreten Code bewertet: 42 werden durch Codeänderungen
geschlossen, 14 sind False Positives und vier werden wegen der Kompatibilität stabiler IDs bewusst
akzeptiert. Die Regex-Bewertung verwendete adversariale Messreihen mit 1.000, 2.000, 4.000 und
8.000 Wiederholungen. Die Markdown-Linkmuster skalierten dabei quadratisch; der Regressionstest mit
20.000 fehlgeschlagenen Linkanfängen benötigte vor dem Fix rund 734 ms und muss nach dem linearen
Scanner unter 150 ms bleiben.

Die Sonar-MCP-Funktion für normale Issues unterstützt zwar Statuswechsel, aber keine Kommentare. Die
SonarQube-Cloud-Oberfläche war sowohl im internen Browser als auch in der verfügbaren Chrome-Sitzung
nicht authentifiziert; ein passendes Token steht der Shell nicht zur Verfügung. Deshalb bleibt die
Serveraktion für `FALSE_POSITIVE` und `ACCEPTED` offen. Ohne dauerhaften Kommentar wurde bewusst kein
Status geändert.

| Issue-Key | Regel / Fundstelle | Klassifikation | Technische Relevanz, Risiko und Fix | Testnachweis | Serveraktion |
| --- | --- | --- | --- | --- | --- |
| AZ_l6Cm5LlJq96xp0cc_ | S9011 · `Button.tsx:76` | FIX | Nativer Default wäre `submit`; sicherer Default `button`, explizites `submit` bleibt möglich. Geringes Risiko. | `busy-indicator.test.ts` | Folgescan muss schließen |
| AZ_l6CmxLlJq96xp0cc8 | S9011 · `IconButton.tsx:39` | FIX | Wie vorstehend; verhindert unbeabsichtigte Formularaktionen. Geringes Risiko. | `busy-indicator.test.ts` | Folgescan muss schließen |
| AZ_l6ChYLlJq96xp0ca_ | S6853 · `FactoryResetDialog.tsx:119` | FALSE_POSITIVE | Das native Label umschließt Checkbox und sichtbaren Text in `strong`/`small`; Zuordnung und zugänglicher Name sind vorhanden. Eine Umschreibung könnte die Klickfläche verschlechtern. | DOM-Struktur + HTML-Label-Semantik | Kommentar + Status offen |
| AZ_l6ChYLlJq96xp0cbA | S6853 · `FactoryResetDialog.tsx:130` | FALSE_POSITIVE | Dasselbe nachweislich korrekte native Labelmuster. | DOM-Struktur + HTML-Label-Semantik | Kommentar + Status offen |
| AZ_l6Ck9LlJq96xp0ccg | S8786 · `analysis-client-diagnostics.ts:36` | FALSE_POSITIVE | Safari-Muster zeigte lineare Skalierung; User-Agent ist zusätzlich praktisch begrenzt. Kein Backtracking-Risiko nachweisbar. | adversarialer Benchmark; bestehender `browserVersion`-Test | Kommentar + Status offen |
| AZ_1TeHjXSRXGTervM09 | S6847 · `CashierTicketPresentation.tsx:99` | FALSE_POSITIVE | `<dialog>` ist ein natives Dialogelement; `onCancel`, Backdrop-Klick und Close-Fokus sind die tatsächliche Interaktion. Ein künstlicher Rollenwechsel wäre semantisch schlechter. | Codepfad und native Dialog-Semantik | Kommentar + Status offen |
| AZ_l6CikLlJq96xp0cbR | S6853 · `FidsSettingsDialog.tsx:198` | FALSE_POSITIVE | Checkbox liegt im Label, sichtbarer Text folgt in `strong`/`small`; Name und Zuordnung sind vorhanden. | DOM-Struktur + HTML-Label-Semantik | Kommentar + Status offen |
| AZ_l6CdYLlJq96xp0cZh | S6847 · `ForecastTimeline.tsx:281` | FALSE_POSITIVE | Der überlaufende Zeitachsenbereich ist absichtlich per Tastatur scrollbar; Handler implementiert PageUp/PageDown/Home/End. | `forecast-simulation-ui.test.ts` + Handlerprüfung | Kommentar + Status offen |
| AZ_l6CdYLlJq96xp0cZi | S6845 · `ForecastTimeline.tsx:286` | FALSE_POSITIVE | `tabIndex=0` ist für die Tastaturbedienung des Scrollbereichs erforderlich; Entfernen wäre eine Accessibility-Regression. | `forecast-simulation-ui.test.ts` | Kommentar + Status offen |
| AZ_l6Cd2LlJq96xp0cZ9 | S6772 · `ScenarioEditor.tsx:675` | FIX | Expliziter JSX-Abstand beseitigt uneindeutige Textverkettung. Geringes Risiko. | vollständige UI-/Formatprüfung | Folgescan muss schließen |
| AZ_0hwNyR1I9WvIHxPKE | S7758 · `simulation-primitives.ts:25` | ACCEPTED | Hash ist ein publizierter deterministischer UTF-16-Hash. Codepoint-Umstellung würde bestehende Simulationen für Nicht-BMP-Schlüssel ändern. Neubewertung nur bei versioniertem Hashformat. | Emoji-Stabilität in `simulation-primitives.test.ts` | Kommentar + Status offen |
| AZ_l6CcDLlJq96xp0cZB | S7781 · `simulation-scenario-template.ts:45` | FIX | `replaceAll` ist für den globalen Ausdruck semantisch gleichwertig. Geringes Risiko. | `simulation-plan-import.test.ts` | Folgescan muss schließen |
| AZ_l6CeALlJq96xp0caB | S6772 · `SimulationFoundationDialog.tsx:408` | FIX | Expliziter Abstand zwischen Checkbox und Labeltext. | vollständige UI-/Formatprüfung | Folgescan muss schließen |
| AZ_l6CrRLlJq96xp0cgN | S6853 · `flight-line-view.tsx:1480` | FALSE_POSITIVE | Label umschließt Checkbox und den vollständigen Gruppenbezeichner; zugänglicher Name ist vorhanden. | DOM-Struktur + HTML-Label-Semantik | Kommentar + Status offen |
| AZ_l6CrRLlJq96xp0cgO | S6772 · `flight-line-view.tsx:1570` | FIX | Expliziter Abstand verbessert den zugänglichen Labeltext. | Flight-Line-Tests | Folgescan muss schließen |
| AZ_l6CrRLlJq96xp0cgS | S6772 · `flight-line-view.tsx:1845` | FIX | Expliziter Abstand vor Select. | Flight-Line-Tests | Folgescan muss schließen |
| AZ_l6CrRLlJq96xp0cgT | S6772 · `flight-line-view.tsx:1863` | FIX | Expliziter Abstand vor Input. | Flight-Line-Tests | Folgescan muss schließen |
| AZ_l6CrRLlJq96xp0cgU | S6772 · `flight-line-view.tsx:1984` | FIX | Expliziter Abstand vor Select. | Flight-Line-Tests | Folgescan muss schließen |
| AZ_l6CrRLlJq96xp0cgV | S6772 · `flight-line-view.tsx:1999` | FIX | Expliziter Abstand vor Input. | Flight-Line-Tests | Folgescan muss schließen |
| AZ_l6CrRLlJq96xp0cgW | S6772 · `flight-line-view.tsx:2183` | FIX | Expliziter Abstand vor Input. | Flight-Line-Tests | Folgescan muss schließen |
| AZ_l6Cp0LlJq96xp0ceJ | S6671 · `offline-store.ts:21` | FIX | IndexedDB darf `error=null` liefern; Fallback-`Error` bewahrt Promise-Vertrag. | `offline-store.test.ts` | Folgescan muss schließen |
| AZ_l6Cp0LlJq96xp0ceK | S6671 · `offline-store.ts:51` | FIX | Schreibfehler erhält stets ein `Error`; vorhandene DOMException bleibt erhalten. | `offline-store.test.ts` | Folgescan muss schließen |
| AZ_l6Cp0LlJq96xp0ceL | S6671 · `offline-store.ts:52` | FIX | Abbruch ohne Engine-Ursache erhält explizites `Error`. | `offline-store.test.ts` | Folgescan muss schließen |
| AZ_l6Cp0LlJq96xp0ceM | S6671 · `offline-store.ts:77` | FIX | Lesefehler erhält stets ein `Error`; Fallbackverhalten nach außen bleibt `null`. | `offline-store.test.ts` | Folgescan muss schließen |
| AZ_l6CoTLlJq96xp0cdS | S7781 · `product-editor.ts:13` | FIX | Punkte werden äquivalent mit `replaceAll` entfernt. | `product-editor.test.ts` | Folgescan muss schließen |
| AZ_l6CqrLlJq96xp0cfy | S6772 · `setup-view.tsx:108` | FIX | Expliziter Abstand vor Input. | Setup-Tests | Folgescan muss schließen |
| AZ_l6CqrLlJq96xp0cfz | S6772 · `setup-view.tsx:117` | FIX | Expliziter Abstand vor Input. | Setup-Tests | Folgescan muss schließen |
| AZ_l6CqrLlJq96xp0cf0 | S6772 · `setup-view.tsx:122` | FIX | Expliziter Abstand vor Input. | Setup-Tests | Folgescan muss schließen |
| AZ_l6CqrLlJq96xp0cf1 | S6772 · `setup-view.tsx:131` | FIX | Expliziter Abstand vor Input. | Setup-Tests | Folgescan muss schließen |
| AZ_l6CqrLlJq96xp0cf2 | S6772 · `setup-view.tsx:142` | FIX | Expliziter Abstand vor Input. | Setup-Tests | Folgescan muss schließen |
| AZ_l6CZuLlJq96xp0cXy | S7758 · `crypto.ts:31` | FIX | Eingaben sind nach Typ exakt Bytes 0–255; `fromCodePoint` ist nachweislich äquivalent. | `crypto.test.ts` | Folgescan muss schließen |
| AZ_l6CZuLlJq96xp0cXz | S7758 · `crypto.ts:41` | FIX | `atob` liefert ein Byte je Codepoint; `codePointAt(0)` ist äquivalent. | `crypto.test.ts` | Folgescan muss schließen |
| AZ_l6CZdLlJq96xp0cXm | S7758 · `reset-setup-grant.ts:16` | FIX | Bytebereich garantiert; Unicode-Methode ändert Base64-Ausgabe nicht. | Reset-Setup-Tests | Folgescan muss schließen |
| AZ_oqZw_tOPjZ5mYXd0Q | S8786 · `ticket-read-service.ts:54` | FALSE_POSITIVE | Eingabe des Musters ist ausschließlich intern von `btoa` erzeugt; `=` kann nur als höchstens zweistelliges Suffix vorkommen. Adversariales Muster ist im Datenfluss unmöglich. | Cursor-Roundtriptests + Datenflussprüfung | Kommentar + Status offen |
| AZ_l6CZULlJq96xp0cXk | S7758 · `web-push-request.ts:44` | FIX | `atob`-Binärstring ist auf Byte-Codepoints begrenzt. | `web-push-request.test.ts` | Folgescan muss schließen |
| AZ_l6CZULlJq96xp0cXl | S7758 · `web-push-request.ts:49` | FIX | Uint8Array garantiert 0–255; Ausgabe bleibt bitidentisch. | `web-push-request.test.ts` | Folgescan muss schließen |
| AZ_l6CubLlJq96xp0ciA | S7758 · `dispatch-plan.ts:285` | ACCEPTED | Hash bildet persistierte Batch-IDs und Revisionen aus UTF-16-Codeeinheiten. Änderung wäre inkompatibel. Neubewertung nur mit versionierter ID-Migration. | Dispatch-Plan-Stabilitätstests | Kommentar + Status offen |
| AZ_l6CthLlJq96xp0cht | S7758 · `fids.ts:82` | ACCEPTED | Vorwärtsanteil einer stabilen extern sichtbaren Row-ID; Codepoint-Umstellung ändert Schlüssel. Neubewertung nur mit ID-Versionierung. | Nicht-BMP-Row-ID in `fids.test.ts` | Kommentar + Status offen |
| AZ_l6CthLlJq96xp0chu | S7758 · `fids.ts:83` | ACCEPTED | Rückwärtsanteil derselben stabilen Row-ID; identische Kompatibilitätsentscheidung. | Nicht-BMP-Row-ID in `fids.test.ts` | Kommentar + Status offen |
| AZ_tvunAHB_X69K2orHo | S7758 · `arc42_markdown_to_html.mjs:1` | FIX | Fester Sentinel-Codepoint; Änderung exakt äquivalent. | `build_arc42_bundle.test.ts` | Folgescan muss schließen |
| AZ_tvunAHB_X69K2orHp | S7758 · `arc42_markdown_to_html.mjs:2` | FIX | Fester Sentinel-Codepoint; Änderung exakt äquivalent. | `build_arc42_bundle.test.ts` | Folgescan muss schließen |
| AZ_tvunAHB_X69K2orHq | S8786 · `arc42_markdown_to_html.mjs:33` | ROOT_CAUSE | Quadratische Markdown-Linksuche bestätigt; gemeinsamer linearer Scanner ersetzt alle vier Linkmuster. | adversarialer `build_arc42_bundle.test.ts` | Folgescan muss schließen |
| AZ_tvunAHB_X69K2orHs | S8786 · `arc42_markdown_to_html.mjs:50` | FALSE_POSITIVE | Verankertes Frontmatter-Muster skaliert linear; abschließendes `.*` kann immer konsumieren und erzwingt kein Rücklaufen. | adversarialer Benchmark | Kommentar + Status offen |
| AZ_tvunAHB_X69K2orHw | S8786 · `arc42_markdown_to_html.mjs:101` | FALSE_POSITIVE | Verankertes Heading-Muster skaliert linear; Quantoren sind durch Literal/Anker getrennt. | adversarialer Benchmark | Kommentar + Status offen |
| AZ_tvunAHB_X69K2orHx | S8786 · `arc42_markdown_to_html.mjs:141` | FALSE_POSITIVE | Verankertes Listenmuster skaliert linear; keine nichtlineare Messung reproduzierbar. | adversarialer Benchmark | Kommentar + Status offen |
| AZ_tvukGHB_X69K2orHk | S8786 · `build_arc42_bundle.mjs:18` | FIX | Unbegrenztes CLI-Argument zeigte nichtlineares Suffix-Backtracking; einmaliger Rückwärtsscan ersetzt Regex. | `trimTrailingSlashes`-Test | Folgescan muss schließen |
| AZ_tvukGHB_X69K2orHm | S8786 · `build_arc42_bundle.mjs:31` | ROOT_CAUSE | Bestätigtes quadratisches Linkmuster durch gemeinsamen Scanner beseitigt. | adversarialer `build_arc42_bundle.test.ts` | Folgescan muss schließen |
| AZ_l6CwRLlJq96xp0cie | S8786 · `vapid-keys.mjs:13` | FALSE_POSITIVE | E-Mail-Muster skaliert in adversarialer Messung linear; kein technischer Laufzeitfehler nachweisbar. | adversarialer Benchmark + `vapid-setup-script.test.ts` | Kommentar + Status offen |
| AZ_l6Cy9LlJq96xp0ci_ | S8786 · `verify_analysis_capture_scale.mjs:43` | FALSE_POSITIVE | Nichtlinear nur für unbeschränkte künstliche Namen; reale Dateinamen sind durch das Dateisystem auf 255 Zeichen begrenzt. Maximallast ist vernachlässigbar. | Benchmark bis 8.000 + Dateisystemgrenze | Kommentar + Status offen |
| AZ_tvup0HB_X69K2orHy | S8786 · `verify_arc42_docs.mjs:38` | ROOT_CAUSE | Bestätigtes quadratisches Linkmuster durch gemeinsamen Scanner beseitigt. | `verify_arc42_docs.test.ts` + adversarialer Test | Folgescan muss schließen |
| AZ_l6CvSLlJq96xp0ciR | S8786 · `verify_architecture_docs.mjs:176` | ROOT_CAUSE | Bestätigtes quadratisches Linkmuster durch gemeinsamen Scanner beseitigt. | Dokumentationsprüfung + adversarialer Test | Folgescan muss schließen |
| AZ_l6Cw_LlJq96xp0cin | S7758 · `verify_first_run_setup.mjs:31` | FIX | Fester ASCII-Codepoint 48; exakt äquivalente Unicode-Methode. | V1-Integrationssuite | Folgescan muss schließen |
| AZ_l6Cx8LlJq96xp0cix | S7758 · `verify_fleet_operations.mjs:4` | FIX | Fester ASCII-Codepoint 48; exakt äquivalent. | Fleet-Operations-Suite | Folgescan muss schließen |
| AZ_l6CySLlJq96xp0ci3 | S7758 · `verify_master_data.mjs:4` | FIX | Fester ASCII-Codepoint 48; exakt äquivalent. | Master-Data-Suite | Folgescan muss schließen |
| AZ_l6CwkLlJq96xp0cih | S7758 · `verify_outage_recovery.mjs:6` | FIX | Fester ASCII-Codepoint 48; exakt äquivalent. | Outage-Recovery-Suite | Folgescan muss schließen |
| AZ_l6CyzLlJq96xp0ci8 | S7758 · `verify_pilot_conflict.mjs:4` | FIX | Fester ASCII-Codepoint 48; exakt äquivalent. | Pilot-Conflict-Suite | Folgescan muss schließen |
| AZ_l6CyeLlJq96xp0ci5 | S7758 · `verify_public_monitors.mjs:129` | FIX | Fester ASCII-Codepoint 48; exakt äquivalent. | Public-Monitor-Suite | Folgescan muss schließen |
| AZ_l6CwALlJq96xp0ciY | S7758 · `verify_soak_reliability.mjs:108` | FIX | Fester ASCII-Codepoint 48; exakt äquivalent. | Soak-Reliability-Suite | Folgescan muss schließen |
| AZ_l6CwuLlJq96xp0cij | S7758 · `verify_ticket_corrections.mjs:34` | FIX | Fester ASCII-Codepoint 48; exakt äquivalent. | Ticket-Corrections-Suite | Folgescan muss schließen |
| AZ_l6CwcLlJq96xp0cif | S7758 · `verify_vertical_slice.mjs:19` | FIX | Fester ASCII-Codepoint 48; exakt äquivalent. | Vertical-Slice-Suite | Folgescan muss schließen |

## Übrige Regelcluster

Medium- und Low-Issues dürfen nach identischer Regel und identischem Codemuster gebündelt bewertet
werden; jeder konkrete Issue-Key bleibt über die getrennten MCP-Severity-Abfragen auf dem Server
nachvollziehbar. Bei abweichendem Kontext wird ein Finding aus dem Cluster herausgelöst und einzeln
bewertet.

| Severity | Regel | Issues | Dateien | Bewertung |
| --- | --- | ---: | ---: | --- |
| Medium | typescript:S3358 | 253 | 73 | PENDING |
| Low | typescript:S6759 | 154 | 89 | PENDING |
| Medium | css:S4666 | 74 | 8 | PENDING |
| High | typescript:S3776 | 68 | 54 | PENDING |
| Medium | typescript:S6819 | 29 | 20 | PENDING |
| Medium | typescript:S6772 | 26 | 4 | PENDING |
| Low | typescript:S6582 | 15 | 11 | PENDING |
| Medium | javascript:S4624 | 11 | 7 | PENDING |
| Low | javascript:S7758 | 11 | 10 | PENDING |
| Medium | javascript:S8786 | 10 | 6 | PENDING |
| Low | typescript:S7758 | 9 | 6 | PENDING |
| High | javascript:S3776 | 8 | 5 | PENDING |
| Medium | css:S7924 | 7 | 2 | PENDING |
| Medium | typescript:S4624 | 6 | 5 | PENDING |
| Low | typescript:S6754 | 6 | 6 | PENDING |
| Low | typescript:S9020 | 6 | 4 | PENDING |
| Low | typescript:S4323 | 5 | 5 | PENDING |
| Low | typescript:S7750 | 5 | 5 | PENDING |
| Low | javascript:S6582 | 4 | 4 | PENDING |
| Low | typescript:S6594 | 4 | 3 | PENDING |
| Medium | typescript:S6671 | 4 | 1 | PENDING |
| Medium | typescript:S6847 | 4 | 2 | PENDING |
| Medium | typescript:S6853 | 4 | 3 | PENDING |
| Medium | javascript:S3358 | 3 | 3 | PENDING |
| Low | javascript:S7780 | 3 | 2 | PENDING |
| Medium | typescript:S1854 | 3 | 3 | PENDING |
| Low | typescript:S1874 | 3 | 2 | PENDING |
| Low | typescript:S6551 | 3 | 2 | PENDING |
| Low | typescript:S7718 | 3 | 2 | PENDING |
| Low | typescript:S7780 | 3 | 2 | PENDING |
| Low | typescript:S7786 | 3 | 3 | PENDING |
| High | python:S3776 | 2 | 2 | PENDING |
| Medium | typescript:S6478 | 2 | 2 | PENDING |
| Medium | typescript:S6845 | 2 | 1 | PENDING |
| Low | typescript:S7781 | 2 | 2 | PENDING |
| Medium | typescript:S8786 | 2 | 2 | PENDING |
| Medium | typescript:S9011 | 2 | 2 | PENDING |
| Medium | javascript:S107 | 1 | 1 | PENDING |
| Low | javascript:S7744 | 1 | 1 | PENDING |
| Low | javascript:S7776 | 1 | 1 | PENDING |
| Low | javascript:S7778 | 1 | 1 | PENDING |
| Medium | plsql:S1138 | 1 | 1 | PENDING |
| Medium | python:S6326 | 1 | 1 | PENDING |
| Medium | typescript:S107 | 1 | 1 | PENDING |
| Low | typescript:S4138 | 1 | 1 | PENDING |
| Medium | typescript:S4144 | 1 | 1 | PENDING |
| Medium | typescript:S6479 | 1 | 1 | PENDING |
| Medium | typescript:S6481 | 1 | 1 | PENDING |
| Low | typescript:S6571 | 1 | 1 | PENDING |
| Low | typescript:S6606 | 1 | 1 | PENDING |
| Low | typescript:S7719 | 1 | 1 | PENDING |
| Medium | typescript:S7721 | 1 | 1 | PENDING |
| Low | typescript:S7754 | 1 | 1 | PENDING |
| Low | typescript:S7763 | 1 | 1 | PENDING |
| Low | typescript:S7765 | 1 | 1 | PENDING |
| Medium | typescript:S7785 | 1 | 1 | PENDING |
