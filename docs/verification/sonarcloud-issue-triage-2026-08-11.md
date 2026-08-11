# SonarQube-Cloud-Issue-Triage vom 11. August 2026

## Ausgangslage und Vorgehen

Am 11. August 2026 wurden über die öffentliche SonarQube-Cloud-API alle offenen Issues des Projekts
`aguther_rundflug-leitstand` mit den Typen `BUG` und `VULNERABILITY` abgerufen. Der Bestand umfasste
68 Issues. Jeder Fund wurde gegen den aktuellen Code geprüft. Regelgruppen wurden nur gemeinsam
bearbeitet, wenn Ursache und technische Korrektur identisch waren.

Es wurde keine Regel global deaktiviert. Die sechs bestätigten Scanner-Fehlalarme sind in
`sonar-project.properties` jeweils auf genau eine Regel und genau eine Datei begrenzt.

| Regel | Anzahl | Bewertung | Behandlung |
|---|---:|---|---|
| `typescript:S2871` | 25 | Zuverlässigkeitsschuld | Behoben: explizite technische Sortierung |
| `javascript:S2871` | 9 | Zuverlässigkeitsschuld | Behoben: explizite technische Sortierung |
| `javascript:S4036` | 25 | Härtung möglich | Behoben: absolute Git-/Taskkill-Pfade |
| `typescript:S4036` | 1 | Härtung möglich | Behoben: absoluter Git-Pfad im Vite-Build |
| `typescript:S3923` | 1 | Echte redundante Logik | Behoben |
| `tssecurity:S6105` | 1 | Kein Open Redirect, aber härtbar | Datenbasierte Navigation entfernt |
| `plsql:DeleteOrUpdateWithoutWhereCheck` | 4 | Scanner-Fehlalarm | Einzeln und dateischarf ausgeschlossen |
| `plsql:NullComparison` | 1 | Scanner-Fehlalarm | Einzeln und dateischarf ausgeschlossen |
| `pythonsecurity:S3649` | 1 | Scanner-Fehlalarm | Einzeln und dateischarf ausgeschlossen |

## Behobene Regelgruppen

### Deterministische technische Sortierung (`S2871`)

Parameterlose `sort()`-/`toSorted()`-Aufrufe sortieren zwar definiert nach UTF-16-Codeeinheiten,
machen diese technische Absicht aber nicht sichtbar und werden von Sonar als potenziell falsche
alphabetische Sortierung gewertet. Persistierte IDs, Statuscodes, JSON-Schlüssel und Dateipfade
verwenden nun `compareTechnicalStrings`. Der Comparator verwendet bewusst keine Nutzersprache und
keine Host-Locale; damit bleibt die Reihenfolge zwischen Worker, Browser, CI und Analyse-Replay
identisch.

Die 34 Issues lagen in folgenden Dateien (Mehrfachfunde in einer Datei sind zusammengefasst):

- `packages/domain/src/dispatch-plan.ts` (2), `packages/domain/src/forecast.ts` (2)
- `apps/worker/src/analysis-snapshot.ts` (1), `dispatch-recommendation-lease-service.ts` (4),
  `dispatch-recommendation-selection.ts` (1), `forecast-timeline-service.ts` (1),
  `planning-capture.ts` (1), `rotation-transition-command-service.ts` (6),
  `ticket-read-service.ts` (1)
- `apps/web/src/event-time.ts` (1), `flight-line-shared.tsx` (2), `flight-line-view.tsx` (2),
  `features/cashier/cashier-ticket-status-sync.ts` (1)
- `scripts/build_arc42_bundle.mjs` (1), `replay_analysis_package.mjs` (2),
  `verify_analysis_capture_scale.mjs` (2), `verify_arc42_docs.mjs` (1),
  `verify_migrations.mjs` (1), `verify_refactor_guardrails.mjs` (1) und
  `verify_web_assets.mjs` (1)

Zusätzlich wurde der beim API-Abruf noch nicht gemeldete parameterlose Produktionsaufruf in
`apps/worker/src/report-export-service.ts` korrigiert.

### Feste Toolpfade (`S4036`)

Die Funde lagen ausschließlich in Build-, Dokumentations- und Verifikationswerkzeugen, nicht im
ausgerollten Worker. Dennoch wurde die theoretische `PATH`-Hijacking-Möglichkeit beseitigt:

- Git wird unter Windows über `C:\Program Files\Git\cmd\git.exe`, sonst über `/usr/bin/git`
  gestartet. CI-Builds verwenden weiterhin vorrangig `SOURCE_REVISION`.
- Windows-Prozessbereinigung startet `C:\Windows\System32\taskkill.exe` statt eines über `PATH`
  aufgelösten Programms.

Betroffen waren `apps/web/vite.config.ts`, `scripts/replay_analysis_package.mjs`,
`scripts/verify_web_assets.mjs` sowie 23 Browser-/Integrationsskripte mit Windows-Cleanup.

### Einzelne echte beziehungsweise härtbare Funde

- `typescript:S3923` in `ForecastTimeline.tsx`: Beide Zweige erzeugten identisch `new Date(value)`;
  die redundante Bedingung wurde entfernt.
- `tssecurity:S6105` in `EventSelectionPage.tsx`: Die bisherige Zieladresse war bereits auf
  Pfad, Query und Hash derselben Origin reduziert und daher kein Open Redirect. Trotzdem erfolgt der
  Veranstaltungswechsel jetzt ohne datenbasierte `location.assign`-Navigation: Der bereinigte
  relative Zustand wird mit `history.replaceState` gesetzt und anschließend dieselbe Seite neu
  geladen.

## Einzeln bestätigte Scanner-Fehlalarme

| Sonar-Issue | Datei und Regel | Prüfung und Begründung |
|---|---|---|
| `AZ_l6CVFLlJq96xp0cWM` | `0015_product_and_gate_master_data.sql`, `plsql:NullComparison` | Sonar analysiert SQLite als PL/SQL und interpretiert den Vergleich `code = ''` nach Oracle-Semantik. In SQLite ist der leere String kein `NULL`; die Migration prüft korrekt den unmittelbar zuvor gesetzten Default. |
| `AZ_l6CT_LlJq96xp0cV_` | `0036_product_promised_flight_time.sql`, `plsql:DeleteOrUpdateWithoutWhereCheck` | Absichtlicher einmaliger Backfill aller beim Hinzufügen der Spalte vorhandenen Produkte. Eine WHERE-Einschränkung würde den Migrationszweck verändern. |
| `AZ_l6CVNLlJq96xp0cWP` | `0038_aircraft_state_changed_at.sql`, `plsql:DeleteOrUpdateWithoutWhereCheck` | Absichtlicher Backfill aller vorhandenen Flugzeuge aus Audit-/Umlaufhistorie; kein Laufzeitkommando und keine nutzergesteuerte Abfrage. |
| `AZ_l6CU8LlJq96xp0cWL` | `0040_resource_group_short_codes.sql`, `plsql:DeleteOrUpdateWithoutWhereCheck` | Absichtliche Initialisierung der neu eingeführten Pflichtkennung für jede bestehende Ressourcengruppe. |
| `AZ_l6CVnLlJq96xp0cWU` | `0068_booking_segment_order.sql`, `plsql:DeleteOrUpdateWithoutWhereCheck` | Absichtlicher vollständiger Backfill der neu eingeführten technischen Segmentreihenfolge aus dem append-only Event Ledger. |
| `AZ_l6CxHLlJq96xp0ciq` | `scripts/verify_backup_restore.py`, `pythonsecurity:S3649` | Tabellennamen stammen ausschließlich aus der versionierten `BACKUP_TABLES`-Konstante und werden zusätzlich per Regex `[a-z_]+` extrahiert. Nutzereingaben erreichen die SQL-Identifier nicht; SQLite unterstützt keine Identifier-Parameter. |

Historische Migrationen werden nicht nachträglich semantisch umgeschrieben. Die datei- und
regelscharfen Kriterien halten alle anderen Regeln in diesen Dateien sowie dieselben Regeln in neuen
Migrationen aktiv.

## Verifikation

Der vollständige lokale Repository-Check war erfolgreich: Lint, Refactoring-Ratchets, Typprüfung,
1.562 Unit-/Integrationstests, Web- und Worker-Build, Worker-Runtime, V1-Integrationen,
V1-Abnahmetag, Backup-Restore sowie Dokumentations- und Requirements-Prüfung bestanden.

Der anschließende authentifizierte CI-Scan analysierte am 11. August 2026 exakt Revision
`38651339e0386d9daf5b303bbd8fa98fc4a37a96`. SonarQube Cloud meldete danach **0 offene Bugs oder
Vulnerabilities**. Das allgemeine Quality Gate blieb separat wegen einer New-Code-Coverage von
53,9 % bei einem Schwellwert von 80 % auf `ERROR`; diese Testabdeckungsschuld ist nicht Bestandteil
der hier abgeschlossenen Issue-Triage und wird als eigenes Arbeitspaket behandelt.
