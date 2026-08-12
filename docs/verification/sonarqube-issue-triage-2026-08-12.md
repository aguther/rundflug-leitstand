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
| AZ_l6CYHLlJq96xp0cXO | High | Maintainability | typescript:S3776 | `apps/worker/src/master-data-command-service.ts:610` | Refactor this function to reduce its Cognitive Complexity from 45 to the 15 allowed. | PENDING | PENDING | PENDING | PENDING | PENDING |
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

## Reliability-Issues – Einzelbewertung erforderlich

| Issue-Key | Severity | Qualität | Regel | Fundstelle | Problem | Klassifikation | Technische Relevanz / Begründung | Änderungsrisiko | Testnachweis | Serveraktion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AZ_l6Cm5LlJq96xp0cc_ | Medium | Reliability | typescript:S9011 | `apps/web/src/design-system/components/Button.tsx:76` | Add an explicit "type" attribute to this button. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CmxLlJq96xp0cc8 | Medium | Reliability | typescript:S9011 | `apps/web/src/design-system/components/IconButton.tsx:39` | Add an explicit "type" attribute to this button. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6ChYLlJq96xp0ca_ | Medium | Reliability | typescript:S6853 | `apps/web/src/features/admin/FactoryResetDialog.tsx:119` | A form label must have accessible text. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6ChYLlJq96xp0cbA | Medium | Reliability | typescript:S6853 | `apps/web/src/features/admin/FactoryResetDialog.tsx:130` | A form label must have accessible text. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Ck9LlJq96xp0ccg | Medium | Reliability | typescript:S8786 | `apps/web/src/features/analysis/analysis-client-diagnostics.ts:36` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_1TeHjXSRXGTervM09 | Medium | Reliability | typescript:S6847 | `apps/web/src/features/cashier/CashierTicketPresentation.tsx:99` | Non-interactive elements should not be assigned mouse or keyboard event listeners. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CikLlJq96xp0cbR | Medium | Reliability | typescript:S6853 | `apps/web/src/features/fids/FidsSettingsDialog.tsx:198` | A form label must have accessible text. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CdYLlJq96xp0cZh | Medium | Reliability | typescript:S6847 | `apps/web/src/features/forecast-simulation/ForecastTimeline.tsx:281` | Non-interactive elements should not be assigned mouse or keyboard event listeners. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CdYLlJq96xp0cZi | Medium | Reliability | typescript:S6845 | `apps/web/src/features/forecast-simulation/ForecastTimeline.tsx:286` | `tabIndex` should only be declared on interactive elements. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cd2LlJq96xp0cZ9 | Medium | Reliability | typescript:S6772 | `apps/web/src/features/forecast-simulation/ScenarioEditor.tsx:675` | Ambiguous spacing before next element small | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_0hwNyR1I9WvIHxPKE | Low | Reliability | typescript:S7758 | `apps/web/src/features/forecast-simulation/simulation-primitives.ts:25` | Prefer `String#codePointAt()` over `String#charCodeAt()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CcDLlJq96xp0cZB | Low | Reliability | typescript:S7781 | `apps/web/src/features/forecast-simulation/simulation-scenario-template.ts:45` | Prefer `String#replaceAll()` over `String#replace()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CeALlJq96xp0caB | Medium | Reliability | typescript:S6772 | `apps/web/src/features/forecast-simulation/SimulationFoundationDialog.tsx:408` | Ambiguous spacing after previous element input | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CrRLlJq96xp0cgN | Medium | Reliability | typescript:S6853 | `apps/web/src/flight-line-view.tsx:1480` | A form label must have accessible text. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CrRLlJq96xp0cgO | Medium | Reliability | typescript:S6772 | `apps/web/src/flight-line-view.tsx:1570` | Ambiguous spacing before next element input | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CrRLlJq96xp0cgS | Medium | Reliability | typescript:S6772 | `apps/web/src/flight-line-view.tsx:1845` | Ambiguous spacing before next element select | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CrRLlJq96xp0cgT | Medium | Reliability | typescript:S6772 | `apps/web/src/flight-line-view.tsx:1863` | Ambiguous spacing before next element input | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CrRLlJq96xp0cgU | Medium | Reliability | typescript:S6772 | `apps/web/src/flight-line-view.tsx:1984` | Ambiguous spacing before next element select | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CrRLlJq96xp0cgV | Medium | Reliability | typescript:S6772 | `apps/web/src/flight-line-view.tsx:1999` | Ambiguous spacing before next element input | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CrRLlJq96xp0cgW | Medium | Reliability | typescript:S6772 | `apps/web/src/flight-line-view.tsx:2183` | Ambiguous spacing before next element input | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cp0LlJq96xp0ceJ | Medium | Reliability | typescript:S6671 | `apps/web/src/offline-store.ts:21` | Expected the Promise rejection reason to be an Error. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cp0LlJq96xp0ceK | Medium | Reliability | typescript:S6671 | `apps/web/src/offline-store.ts:51` | Expected the Promise rejection reason to be an Error. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cp0LlJq96xp0ceL | Medium | Reliability | typescript:S6671 | `apps/web/src/offline-store.ts:52` | Expected the Promise rejection reason to be an Error. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cp0LlJq96xp0ceM | Medium | Reliability | typescript:S6671 | `apps/web/src/offline-store.ts:77` | Expected the Promise rejection reason to be an Error. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CoTLlJq96xp0cdS | Low | Reliability | typescript:S7781 | `apps/web/src/product-editor.ts:13` | Prefer `String#replaceAll()` over `String#replace()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CqrLlJq96xp0cfy | Medium | Reliability | typescript:S6772 | `apps/web/src/setup-view.tsx:108` | Ambiguous spacing before next element input | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CqrLlJq96xp0cfz | Medium | Reliability | typescript:S6772 | `apps/web/src/setup-view.tsx:117` | Ambiguous spacing before next element input | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CqrLlJq96xp0cf0 | Medium | Reliability | typescript:S6772 | `apps/web/src/setup-view.tsx:122` | Ambiguous spacing before next element input | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CqrLlJq96xp0cf1 | Medium | Reliability | typescript:S6772 | `apps/web/src/setup-view.tsx:131` | Ambiguous spacing before next element input | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CqrLlJq96xp0cf2 | Medium | Reliability | typescript:S6772 | `apps/web/src/setup-view.tsx:142` | Ambiguous spacing before next element input | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CZuLlJq96xp0cXy | Low | Reliability | typescript:S7758 | `apps/worker/src/crypto.ts:31` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CZuLlJq96xp0cXz | Low | Reliability | typescript:S7758 | `apps/worker/src/crypto.ts:41` | Prefer `String#codePointAt()` over `String#charCodeAt()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CZdLlJq96xp0cXm | Low | Reliability | typescript:S7758 | `apps/worker/src/reset-setup-grant.ts:16` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_oqZw_tOPjZ5mYXd0Q | Medium | Reliability | typescript:S8786 | `apps/worker/src/ticket-read-service.ts:54` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CZULlJq96xp0cXk | Low | Reliability | typescript:S7758 | `apps/worker/src/web-push-request.ts:44` | Prefer `String#codePointAt()` over `String#charCodeAt()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CZULlJq96xp0cXl | Low | Reliability | typescript:S7758 | `apps/worker/src/web-push-request.ts:49` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CubLlJq96xp0ciA | Low | Reliability | typescript:S7758 | `packages/domain/src/dispatch-plan.ts:285` | Prefer `String#codePointAt()` over `String#charCodeAt()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CthLlJq96xp0cht | Low | Reliability | typescript:S7758 | `packages/domain/src/fids.ts:82` | Prefer `String#codePointAt()` over `String#charCodeAt()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CthLlJq96xp0chu | Low | Reliability | typescript:S7758 | `packages/domain/src/fids.ts:83` | Prefer `String#codePointAt()` over `String#charCodeAt()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvunAHB_X69K2orHo | Low | Reliability | javascript:S7758 | `scripts/arc42_markdown_to_html.mjs:1` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvunAHB_X69K2orHp | Low | Reliability | javascript:S7758 | `scripts/arc42_markdown_to_html.mjs:2` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvunAHB_X69K2orHq | Medium | Reliability | javascript:S8786 | `scripts/arc42_markdown_to_html.mjs:33` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvunAHB_X69K2orHs | Medium | Reliability | javascript:S8786 | `scripts/arc42_markdown_to_html.mjs:50` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvunAHB_X69K2orHw | Medium | Reliability | javascript:S8786 | `scripts/arc42_markdown_to_html.mjs:101` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvunAHB_X69K2orHx | Medium | Reliability | javascript:S8786 | `scripts/arc42_markdown_to_html.mjs:141` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvukGHB_X69K2orHk | Medium | Reliability | javascript:S8786 | `scripts/build_arc42_bundle.mjs:18` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvukGHB_X69K2orHm | Medium | Reliability | javascript:S8786 | `scripts/build_arc42_bundle.mjs:31` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CwRLlJq96xp0cie | Medium | Reliability | javascript:S8786 | `scripts/vapid-keys.mjs:13` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cy9LlJq96xp0ci_ | Medium | Reliability | javascript:S8786 | `scripts/verify_analysis_capture_scale.mjs:43` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_tvup0HB_X69K2orHy | Medium | Reliability | javascript:S8786 | `scripts/verify_arc42_docs.mjs:38` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CvSLlJq96xp0ciR | Medium | Reliability | javascript:S8786 | `scripts/verify_architecture_docs.mjs:176` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cw_LlJq96xp0cin | Low | Reliability | javascript:S7758 | `scripts/verify_first_run_setup.mjs:31` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6Cx8LlJq96xp0cix | Low | Reliability | javascript:S7758 | `scripts/verify_fleet_operations.mjs:4` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CySLlJq96xp0ci3 | Low | Reliability | javascript:S7758 | `scripts/verify_master_data.mjs:4` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CwkLlJq96xp0cih | Low | Reliability | javascript:S7758 | `scripts/verify_outage_recovery.mjs:6` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CyzLlJq96xp0ci8 | Low | Reliability | javascript:S7758 | `scripts/verify_pilot_conflict.mjs:4` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CyeLlJq96xp0ci5 | Low | Reliability | javascript:S7758 | `scripts/verify_public_monitors.mjs:129` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CwALlJq96xp0ciY | Low | Reliability | javascript:S7758 | `scripts/verify_soak_reliability.mjs:108` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CwuLlJq96xp0cij | Low | Reliability | javascript:S7758 | `scripts/verify_ticket_corrections.mjs:34` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |
| AZ_l6CwcLlJq96xp0cif | Low | Reliability | javascript:S7758 | `scripts/verify_vertical_slice.mjs:19` | Prefer `String.fromCodePoint()` over `String.fromCharCode()`. | PENDING | PENDING | PENDING | PENDING | PENDING |

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
