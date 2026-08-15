# Konsolidierte Analyse technischer Schulden – 10. August 2026

Berichtsstand: 11. August 2026
Repository- und SonarCloud-Messstand: `da55ad776ebaef8db34fc8fd19b930a83c7f21eb`
Applikationsversion: 1.12.0

Dieser Bericht konsolidiert die gepflegte Restschuldenliste
[`technical-debt-1.12.0.md`](technical-debt-1.12.0.md), eine unabhängige externe Analyse, eine
erneute Prüfung des Repositorys sowie die SonarCloud-Analyse desselben Commits. Externe und
automatisierte Befunde wurden nicht ungeprüft übernommen: Jeder priorisierte Punkt wurde am Code,
an den Tests oder an der CI-Konfiguration nachvollzogen. Sonar-Funde werden als Signal verstanden,
nicht automatisch als nachgewiesener Fehler.

## 1. Executive Summary

**Geschätztes Schulden-Level: Hoch – bei einer grundsätzlich soliden technischen Basis.**

Das Repository ist strukturell deutlich besser als ein typisches Legacy-System dieser Größe:

- React-PWA, Worker, Contracts und reine Domain-Schicht sind erkennbar getrennt.
- Die Domain besitzt keine Cloudflare-, HTTP- oder Datenbankabhängigkeiten.
- TypeScript wird konsequent eingesetzt; im geprüften Produktionscode fanden sich keine breit
  verwendeten `any`-Ausweichkonstrukte, `TODO`-Cluster oder stillen TypeScript-Unterdrückungen.
- Audit, erwartete Version, Idempotenz und atomare Persistenz sind als wiederkehrende
  Architekturmechanismen vorhanden.
- WebCrypto, Security-Header, HttpOnly-Cookies und Request-Grenzen sind sinnvoll umgesetzt.
- 1.539 reguläre Tests sowie 23 Worker-Runtime-Tests bestanden. Der Dependency-Audit meldete keine
  bekannten Schwachstellen.

Das hohe Schuldenniveau entsteht nicht durch flächendeckend schlechte Qualität, sondern durch wenige
sehr große und geschäftskritische Konzentrationspunkte:

- Kommandodispatch, Forecast-Orchestrierung und mehrere UI-Workflows liegen in Methoden oder
  Komponenten mit mehreren hundert bis mehr als tausend zusammenhängenden Zeilen.
- Kritische Worker-Pfade koppeln D1-Zugriff, Fachprojektion, Persistenz, Realtime und Push eng.
- Öffentliche Ticketcodes werden vom offiziellen Client sicher erzeugt, aber die notwendige
  Nicht-Aufzählbarkeit wird an der Servergrenze nicht durchgesetzt.
- Das portable Backup puffert wachsende Tabellen vollständig im Worker-Speicher.
- Das Operations-Board bezahlt viele serielle D1-Zugriffe und wiederholte lineare Suchen.
- Die Testmenge ist hoch, doch wichtige UI-Tests prüfen Quelltextstrings statt beobachtbares
  Verhalten. Vollständig unimportierte Dateien fehlen teilweise sogar aus der Coverage-Grundmenge.
- Das lokale Refactoring-Gate und die PR-CI bilden die tatsächlich risikoreichen Laufzeitprüfungen
  nicht zuverlässig ab.

### SonarCloud-Einordnung

Die [SonarCloud-Analyse](https://sonarcloud.io/summary/overall?id=aguther_rundflug-leitstand) wurde am
10. August 2026 für exakt denselben Commit ausgeführt. Das Quality Gate ist rot.

| Kennzahl | SonarCloud-Wert | Bewertung |
|---|---:|---|
| Gesamt-Coverage | 52,0 % | Zu niedrig und wegen fehlender Dateien noch zu optimistisch |
| Line Coverage | 48,9 % | Kritische Adapterpfade sind unzureichend abgedeckt |
| Branch Coverage | 57,2 % | Viele Fehler- und Konkurrenzpfade bleiben ungemessen |
| New-Code-Coverage | 53,9 % bei Ziel 80 % | Quality-Gate-Verstoß |
| Duplicated Lines | 2,3 % gesamt, 1,7 % New Code | Gesamtwert akzeptabel; lokale Ausreißer bleiben |
| Code Smells | 870 | Vor allem Nested Ternaries, Props-Mutability, Komplexität und CSS |
| Bugs | 38 | Größtenteils regelbedingte Fehlklassifikation technischer Sortierung |
| Vulnerabilities | 28 | Größtenteils Tooling-`PATH`; zwei Blocker sind nach Codeprüfung Fehlalarme |
| Security Hotspots | 0 offen | Kein Beleg für Abwesenheit domänenspezifischer Risiken |
| Maintainability Debt | 6.666 Minuten, etwa 111 Stunden | Sonar bewertet Maintainability dennoch mit A |
| Analysierte NCLOC | 120.128 | Enthält neben TS/TSX auch CSS, SQL und Skripte |

Die Ratings dürfen nicht wörtlich als 38 reale Laufzeitfehler und 28 reale Sicherheitslücken gelesen
werden:

- 26 Vulnerabilities betreffen die Auflösung von Entwicklungswerkzeugen über `PATH` in Vite- oder
  Prüfharness-Code.
- Der gemeldete Blocker in `EventSelectionPage.tsx` verwendet nach Prüfung nur einen aus der
  aktuellen URL abgeleiteten relativen Same-Origin-Pfad; ein Redirect auf eine fremde Origin ist
  nicht möglich.
- Der Python-SQL-Injection-Blocker führt ausschließlich versionierte Migrationsdateien aus dem
  Repository aus, keine nutzergesteuerten SQL-Fragmente.
- 31 Bugs beanstanden parameterloses `.sort()` für technische IDs, Statuswerte, Pfade oder
  ISO-Zeitwerte. Eine sprachabhängige Sortierung mit `localeCompare` wäre hierfür nicht pauschal
  richtiger. Ein expliziter, locale-unabhängiger Comparator kann die Absicht klarstellen.
- Vier SQL-Blocker sind beabsichtigte Volltabellen-Backfills in additiven SQLite-Migrationen.

Die aussagekräftigsten Sonar-Signale bestätigen dagegen die manuelle Analyse:

- 85 offene Cognitive-Complexity-Funde; Spitzenwerte sind 265 in
  `operational-engine.ts`, 161 in `engine.ts`, 150 in `event-coordinator.ts` und 115 in
  `flight-line-view.tsx`.
- `event-coordinator.ts` und `forecast-timeline-service.ts` stehen bei jeweils 0 % gemeldeter
  Coverage; `operational-engine.ts` bei 0,3 %.
- Für `flight-line-view.tsx` und `cashier-view.tsx` weist Sonar nicht einmal `lines_to_cover` aus.
  Da Vitest kein explizites `coverage.include` besitzt, fehlen vollständig unimportierte Dateien aus
  LCOV und damit aus dem Nenner. Die angezeigten 52 % überschätzen den tatsächlichen Schutz.
- `operational-engine.ts` besitzt 13,2 % und `engine.ts` 9,3 % duplizierte Zeilen. Das bestätigt die
  parallelen Simulationsprimitive.
- CSS-Duplikation konzentriert sich unter anderem in `admin-v12.css` und `flight-line-v12.css`.

### Korrekturen am externen Bericht

Folgende Aussagen wurden präzisiert oder verworfen:

- `FlightLineView` verwendet 13, nicht 21 `useState`-Hooks; `CashierView` verwendet 18, nicht 30.
  Die Komponenten bleiben wegen Umfang und Verantwortungsmischung dennoch klare Hotspots.
- `packages/domain/src/forecast.ts` besitzt 92,5 % Sonar-Coverage und umfangreiche Tests. Das Problem
  ist die innere Komplexität und fehlende isolierte Testbarkeit einzelner Phasen, nicht eine generell
  ungetestete Gesamtfunktion.
- Die fünf zum Analysezeitpunkt vorhandenen Rollen-PDFs mit `v1.11.0` im Namen waren keine
  versehentlich veralteten Buildartefakte. Im anschließenden Verbesserungsprogramm wurden Quellen,
  synthetische Screenshots und PDFs bewusst auf V1.12 aktualisiert und die V1.11-Artefakte ersetzt.
- `style-src 'unsafe-inline'` ist kein isolierter Quick Win. Das Frontend besitzt 28 dynamische
  Inline-Styles, vor allem für Diagrammpositionen. Eine CSP-Härtung benötigt eine geplante Migration
  auf CSS-Variablen, Nonces oder andere kompatible Darstellungsmechanismen.
- Die sequenzielle Command-Kette bleibt ein Open/Closed- und Lesbarkeitsproblem. Die pauschale
  Behauptung, alle Zweige seien wegen fehlender Rückgaben zeilenreihenfolgeabhängig, wird jedoch nicht
  übernommen.

## 2. Top-Prioritäten

Die Reihenfolge berücksichtigt zuerst betriebliche beziehungsweise sicherheitsbezogene Wirkung und
danach den Aufwand. Kleine Maßnahmen mit hoher Wirkung stehen vor großen Strukturumbauten; eine
kritische Sicherheitsinvariante bleibt auch bei mittlerem Aufwand P0.

### Quick Wins – hohe Wirkung bei geringem Aufwand

#### P0 – Wartungsfehler können das tägliche Backup verhindern

**Pfad:** `apps/worker/src/index.ts:185`

Der Cron-Handler führt Push-Bereinigung, Archivablauf, Archivbau und Backup sequenziell ohne getrennte
Fehlergrenzen aus. Wirft ein früher Schritt, wird das Backup nicht mehr versucht. Die Jobs benötigen
separate Fehlerbehandlung und strukturierte Ergebnisprotokolle; fachlich notwendige Abhängigkeiten
müssen ausdrücklich modelliert werden.

#### P0 – Kein Renderfehler-Fallback im operativen Frontend

**Pfad:** `apps/web/src/`

Es existiert keine React Error Boundary. Ein unerwarteter Renderfehler kann Kasse oder Flight Line in
einen weißen Bildschirm versetzen. Ein globaler Fallback und zusätzliche Routengrenzen sind mit
kleinem Implementierungsaufwand möglich und verbessern die Wiederherstellbarkeit im Live-Betrieb.

#### P0 – Coverage und Sonar-Gate vermitteln ein unvollständiges Bild

**Pfade:** `vitest.config.ts`, `.github/workflows/ci.yml`, `sonar-project.properties`

Ohne `coverage.include` fehlen vollständig unimportierte Produktionsdateien. Zusätzlich wartet der
CI-Workflow mit `sonar.qualitygate.wait=false` nicht auf das Ergebnis. Die GitHub-Branch-Protection
ist außerhalb des Repositorys nicht prüfbar; der Workflow selbst erzwingt das Gate jedenfalls nicht.
Zuerst muss ein ehrlicher Coverage-Nenner hergestellt und der Sonar-Bestand fachlich triagiert
werden, danach kann das Gate blockierend werden.

#### P1 – Aussagekräftige Runtime-Prüfungen fehlen im Pull-Request-Gate

**Pfade:** `.github/workflows/ci.yml`, `package.json`

Die PR-CI führt Coverage und `check:ci`, aber weder die 23 Worker-Runtime-Tests noch
`test:v1-integrations`, Backup/Restore oder die vollständige Dokumentationsprüfung aus. Diese Checks
laufen erst in manuellen oder Deployment-Abläufen. Sie sollten als parallele, klar begrenzte Jobs
statt als ein zu langer monolithischer Job ergänzt werden.

#### P1 – Lokale Refactoring-Guardrails liefern Fehlalarme

**Pfad:** `scripts/verify_refactor_guardrails.mjs:28`

Das Skript traversiert fast den gesamten Verzeichnisbaum und berücksichtigt Git-Ignores nicht.
Dadurch werden ignorierte `.claude/worktrees` als neue Quelltextverstöße gemeldet. Zusätzlich kann
eine ignorierte `wrangler.*.generated.jsonc` das normale Biome-Kommando brechen. Qualitätstore müssen
versionierte Quellen oder explizite Quellwurzeln prüfen.

#### P1 – N+1-Abfragen in der Master-Data-Validierung

**Pfad:** `apps/worker/src/admin-master-data-template-routes.ts:103`

Bis zu 200 Flugzeugregistrierungen werden einzeln gegen D1 geprüft; Validate-then-Import kann die
Arbeit wiederholen. Eine gebündelte Abfrage und ein lokales `Set` beseitigen die serielle Latenz ohne
fachliche Änderung.

#### P2 – Dokumentationswiderspruch bei Sitzungsdauer

**Pfade:** `docs/adr/0010-anonyme-helferkonten-und-sitzungen.md`,
`docs/requirements/requirements-v1.12.0.md`

ADR-0010 steht weiterhin auf „Accepted“, obwohl neuere Entscheidungen und Requirements die dort
genannten Idle- und Maximallaufzeiten ersetzt haben. Die ADR muss als teilweise überholt markiert
und mit der Nachfolgeentscheidung verknüpft werden.

### Große Baustellen – hohe Wirkung bei mittlerem bis hohem Aufwand

#### P0 – Nicht-Aufzählbarkeit öffentlicher Codes wird nur clientseitig erzeugt

**Pfade:** `packages/contracts/src/operations-dispatch.ts:294`,
`packages/domain/src/index.ts:368`, `apps/worker/src/event-coordinator.ts:777`,
`apps/web/src/operation-workspace.tsx:271`

Der offizielle Client erzeugt starke Codes mit WebCrypto. Contract und Worker akzeptieren jedoch
beliebige formatgültige Codes. Ein manipulierter authentifizierter Kassenclient könnte deshalb einen
vorhersagbaren Code wie `AAAAAAAAAAAA` einreichen. Der Hash schützt einen schwachen öffentlichen Code
nicht vor Enumeration. Sicherheitsrelevante Zufallswerte müssen im Worker erzeugt und über
idempotente Ergebnisse an den Client zurückgegeben werden.

#### P1 – Quelltexttests ersetzen Verhaltenstests der wichtigsten Oberflächen

**Pfade:** `apps/web/src/flight-line-view.tsx`, `apps/web/src/cashier-view.tsx`

`FlightLineView` umfasst etwa 2.100 NCLOC, `CashierView` etwa 1.630 NCLOC. Direkte Testreferenzen
importieren beide Komponenten ausschließlich als `?raw`-Text. Insgesamt bestehen 200 Raw-Imports in
65 Testdateien und 1.805 `.toContain`-Vorkommen. Nicht jedes `toContain` ist problematisch, aber
1.071 Assertions prüfen nach der externen Erhebung direkt Source-/Raw-/Migration-Strings. Diese Tests
können bei sicherem Refactoring falsch-rot und bei echtem Laufzeitversagen falsch-grün werden.

#### P1 – Operations-Board kombiniert serielle D1-Zugriffe mit teurer Projektion

**Pfade:** `apps/worker/src/operations-read-service.ts:8`,
`apps/worker/src/d1-read-scheduler.ts:1`, `apps/worker/src/operations-routes.ts:42`

Das Read Model lädt ungefähr 15 unabhängige Datenmengen absichtlich seriell. Danach übernimmt eine
ungefähr 1.000 Zeilen lange Route Authentisierung, Fachprojektion und Response-Mapping und sucht
wiederholt mit `find`, `filter` und `includes` in denselben Arrays. D1-Batches, vorindizierte Maps und
eine reine Projektionsfunktion reduzieren Roundtrips, Laufzeitkomplexität und Testaufwand.

#### P1 – Portable Backups skalieren nicht mit wachsenden Datenbeständen

**Pfad:** `apps/worker/src/backup.ts:68`

Alle Backup-Tabellen werden vollständig geladen, gemeinsam als Objekt gehalten, komplett serialisiert
und anschließend gehasht und zu R2 geschrieben. Audit, Forecast-Snapshots, Idempotenzbelege und Outbox
wachsen fortlaufend. Das Repository besitzt in `analysis-archive-writer.ts` bereits ein
Multipart-/Stream-Muster, das für ein versioniertes Backupformat wiederverwendet werden kann.
Cloudflare empfiehlt für große oder unbeschränkte Payloads ebenfalls Streaming statt vollständiger
Pufferung: <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>.

#### P1 – Event Coordinator ist ein zentraler Änderungsengpass

**Pfad:** `apps/worker/src/event-coordinator.ts:499`

`handleCommand` umfasst ungefähr 765 Zeilen und besitzt laut Sonar eine Cognitive Complexity von 150.
Der Coordinator verdrahtet zahlreiche Services, kontrolliert die gemeinsame Präambel und dispatcht
sämtliche Command-Familien. Eine exhaustive typisierte Handler-Registry kann Vollständigkeit zur
Compile-Zeit sichern, während Idempotenz, Autorisierung, Version, Audit und Persistenzgrenze zentral
bleiben.

#### P2 – Forecast-Orchestrierung und Domain-Algorithmus sind zu große Einheiten

**Pfade:** `apps/worker/src/forecast-timeline-service.ts:54`,
`packages/domain/src/forecast.ts:1364`

Die Worker-Neuberechnung umfasst ungefähr 1.328 Zeilen und koppelt Laden, Projektion, Persistenz,
automatische Voraufrufe, Realtime und Push. Sonar meldet für die Datei 0 % Coverage. Die reine
Domain-Datei ist gut abgedeckt, enthält aber Funktionen mit 605 beziehungsweise etwa 450 Zeilen und
einen parallel fortgeführten Legacy-Pfad. Adapterpipeline und Domainphasen müssen getrennt, jedoch
nicht gleichzeitig in einem Big-Bang-Refactoring verändert werden.

#### P2 – Zwei Simulationsengines duplizieren deterministische Primitive

**Pfade:** `apps/web/src/features/forecast-simulation/engine.ts`,
`apps/web/src/features/forecast-simulation/operational-engine.ts`

Elf RNG-, Sampling-, Zeit- und Projektionshelfer sind parallel vorhanden. `runSimulation` und
`runOperationalSimulation` besitzen Sonar-Komplexitäten von 161 beziehungsweise 265; die operative
Engine hat nur 0,3 % Coverage. Divergierende RNG- oder Rundungslogik würde Vergleichsergebnisse
unbemerkt inkompatibel machen.

#### P2 – Web-Modularisierung und Eventkontext sind nur teilweise vollzogen

**Pfad:** `apps/web/src/operation-workspace.tsx:24`

Das Modul wird von mehr als 40 Produktions- und Testdateien referenziert und exportiert Kontext,
Labels, UI-Primitives, Daten-Hooks und Zufallsgeneratoren. `EVENT_ID` und weitere Flags werden beim
Modulimport aus `window.location` eingefroren. Ein Veranstaltungskontext als React Context und
fachliche Feature-Slices reduzieren Kopplung und ermöglichen einen kontrollierten Wechsel ohne
Importzeit-Nebenwirkungen.

#### P3 – Prüfskripte besitzen kein einheitliches isoliertes Harness

**Pfad:** `scripts/`

49 MJS-/Python-Skripte umfassen zusammen etwa 15.096 Zeilen. 23 `verify_*.mjs`-Skripte starten oder
steuern Wrangler; neun referenzieren den festen Port 8787, während nur ein Teil explizite
Temp-/Persistenzisolation verwendet. Wiederholte Portwahl, Migration, Seed, Worker-Start und
Command-Helfer erhöhen Wartungsaufwand und verhindern sichere Parallelisierung.

#### P3 – Interne Domain-Barrels und breite Contracts erhöhen Kopplung

**Pfade:** `packages/domain/src/index.ts`, `packages/contracts/src/operations-dispatch.ts`,
`apps/web/src/api.ts`

Domain-Module importieren Kernsymbole aus dem Barrel, das sie selbst wieder exportiert. Der
Operations-Contract und der Web-API-Client sind mit mehr als tausend Zeilen breite Änderungsflächen.
Direkte interne Imports sowie kompatible öffentliche Re-Exports nach Command-Familien reduzieren
Zyklen und Änderungsfächerung.

## 3. Refactoring-Empfehlungen und Arbeitspakete

Aufwandsskala: **XS** bis 1 Tag, **S** 1–2 Tage, **M** 3–5 Tage, **L** 1–2 Wochen,
**XL** mehr als 2 Wochen. Jedes Arbeitspaket ist ein eigenständig reviewbares Ergebnis auf einem
eigenen Branch und verweist in Tests, Commit-Body oder PR auf die betroffenen Requirements.

| AP | Priorität | Wirkung | Aufwand | Ergebnis und Abnahmekriterium |
|---|---|---|---|---|
| **AP-01** | P0 | Hoch | XS | Cron-Wartungsschritte erhalten getrennte Fehlergrenzen und strukturierte Ergebnislogs. Ein Test lässt jeden Vorjob einzeln scheitern und weist nach, dass das Backup weiterhin versucht wird. |
| **AP-02** | P0 | Hoch | XS | Globaler und routenbezogener Error-Boundary-Fallback im bestehenden Designsystem, ohne sensitive Fehlerdetails, mit „Neu laden“. Vor Implementierung wird ein vollständiges UI-Konzept freigegeben; DOM- und Browser-Test prüfen Fehler und Wiederherstellung. |
| **AP-03** | P0 | Hoch | S | Alle Sonar-Bugs und -Vulnerabilities werden fachlich triagiert. Echte Befunde werden behoben, Fehlalarme einzeln begründet; keine pauschalen Regelabschaltungen. Technische Sortierabsicht wird bei Bedarf durch einen locale-unabhängigen Comparator sichtbar. |
| **AP-04** | P0 | Kritisch | M | Öffentliche Ticket- und Gruppencodes entstehen ausschließlich im Worker. Der Contract akzeptiert keine frei wählbaren Codes mehr; Command-Replay liefert das persistierte Erstergebnis. Bestehende Hashes und URLs bleiben kompatibel. Tests: schwacher Code, Kollision, Replay, getrennte Gruppen-/Ticketcodes. |
| **AP-05** | P0 | Hoch | S | Vitest erfasst per `coverage.include` allen Produktionscode und schließt nur Tests, Deklarationen und generierte Bindings aus. Der neu gemessene Gesamtwert wird abgerundet als Ratchet festgeschrieben; New Code behält das 80-%-Ziel. |
| **AP-06** | P0 | Hoch | S–M | PR-CI erhält parallele Jobs für Worker-Runtime, V1-Kernintegration, Backup/Restore und Dokumentation. Acceptance-Day, Soak und externe Performance bleiben separate Abnahmen. Nach AP-03 und AP-05 wird `sonar.qualitygate.wait=true` aktiviert. |
| **AP-07** | P1 | Mittel–hoch | XS | Refactoring-Guardrail arbeitet nur auf versionierten Dateien oder expliziten Quellwurzeln. Ignorierte Worktrees und generierte Wrangler-Zielkonfigurationen können lokale Gates nicht mehr verfälschen. |
| **AP-08** | P1 | Hoch | M | Master-Data-Registrierungen werden gebündelt geladen; Operations-Reads nutzen D1-Batches und vorindizierte Maps. Tests begrenzen Query-Anzahl und Projektionszeit mit synthetischen Maximaldaten. |
| **AP-09** | P1 | Hoch | L | Rendering- und Interaktionstests für Kasse und Flight Line decken Verkauf, Kapazitätssperre, Storno, Umlauf, Notfall, Verbindungsverlust und Replay ab. Entsprechende Raw-Tests werden anschließend entfernt und die Baseline abgesenkt. |
| **AP-10** | P1 | Hoch | L | Versioniertes, gestreamtes Backup mit inkrementellem Hash, R2-Multipart, Tabellenmanifest und Zeilenzahlen. Restore liest übergangsweise altes und neues Format. Skalierungstest verwendet große synthetische Audit-/Forecast-/Outbox-Bestände. |
| **AP-11** | P1 | Hoch | L | `handleCommand` wird kommandofamilienweise in eine exhaustive typisierte Handler-Registry überführt. Gemeinsame Präambel und Persistenzgrenze bleiben unverändert. Jede Familie besitzt Rollen-, Idempotenz-, Versions-, Audit- und Persistenztests. |
| **AP-12** | P2 | Hoch | XL | Forecast-Adapter wird in Loader, reinen Projector, Repository, Precall-Evaluator und Publication Service geteilt. Danach wird die Domain entlang Sampling, Verfügbarkeit, Projektion und Diagnostik zerlegt. Legacy-Pfad erhält ADR und Abschaltkriterium. |
| **AP-13** | P2 | Mittel–hoch | L | Gemeinsame deterministische Simulationsprimitive mit Seed-Stabilitätstest. Beide Engines werden in fachliche Phasen zerlegt und die operative Engine vollständig in Coverage aufgenommen. |
| **AP-14** | P2 | Mittel–hoch | L | Event-ID wandert aus der Importzeit in React Context; `operation-workspace.tsx`, Kasse und Flight Line werden in Kontext, Hooks und präsentierende Feature-Komponenten aufgeteilt. Freigegebenes UI-Konzept und Light-/Dark-Browserabgleich sind Pflicht. |
| **AP-15** | P3 | Mittel | L | Gemeinsames isoliertes Worker-Testharness, direkte interne Domain-Imports, Contracts nach Command-Familien und CSS-Konsolidierung. ADR-0010 wird als teilweise ersetzt markiert. Die damalige Aufbewahrungsempfehlung für V1.11-Rollen-PDFs wurde im anschließenden Verbesserungsprogramm durch vollständig neu erzeugte V1.12-Artefakte abgelöst. |

### Empfohlene Reihenfolge und Abhängigkeiten

1. **Sofortschutz:** AP-01 und AP-02 unabhängig umsetzen; AP-04 als Sicherheitsinvariante parallel
   vorbereiten.
2. **Mess- und Integrationsnetz:** AP-03, danach AP-05 und AP-06; AP-07 ist unabhängig und sollte im
   selben Zeitraum erfolgen.
3. **Gezielte Performance:** AP-08 vor einer größeren Operations-Route-Aufteilung; AP-10 nach AP-01.
4. **Verhaltensnetz:** AP-09 vor den UI- und Coordinator-Großschnitten abschließen.
5. **Strukturschnitte:** AP-11 bis AP-15 jeweils auf getrennten Branches; keine parallelen Änderungen
   an denselben Contracts, Domain-Barrels oder zentralen Exports.

### Verifikationsbasis und Grenzen

Ausgeführt und erfolgreich:

- `npm run test`: 287 Testdateien, 1.539 Tests.
- `npm run test:worker-runtime`: 8 Testdateien, 23 Tests.
- direkte Worker-TypeScript-Prüfung.
- Wrangler-Binding-Prüfung mit der im Lockfile vorgesehenen Version 4.120.0.
- `npm run lint` im isolierten Dokumentationsworktree: 732 Dateien.
- `npm run docs:verify` einschließlich arc42, Migrationen, Lizenzen und Rollenblättern.
- `npm run requirements:verify`: 341 aktuelle Anforderungen und vollständige Traceability.
- `npm audit --audit-level=moderate` und `npm audit --omit=dev`: keine Findings.
- `npm ci --dry-run`.
- `npm run docs:guides:check`: zum Analysezeitpunkt fünf gültige Rollenblätter für V1.11.0; der
  nachfolgende Dokumentationslauf prüft die ersetzenden V1.12-Artefakte.

Nicht als erfolgreich behauptet:

- Während der Analyse wurde kein erneuter lokaler vollständiger Coverage-Lauf ausgewertet; die
  ursprüngliche Installation war gegenüber dem Lockfile unvollständig. Die belastbaren
  Coverage-Werte stammen aus SonarCloud auf demselben Commit.
- Der im Analysecheckout reproduzierte Lintfehler betraf eine ignorierte generierte Wrangler-Datei;
  der finale isolierte Worktree bestand den vollständigen Repository-Lint.
- `npm run refactor:guardrails` scheiterte am beschriebenen Scan ignorierter `.claude/worktrees`,
  nicht an einem neuen versionierten Raw-Import.
- Build, vollständiger Release-Check und Browserläufe wurden für diese reine Analyse nicht erneut
  ausgeführt. Vorhandene erfolgreiche Nachweise sind in `technical-debt-1.12.0.md` dokumentiert.

Die Bewertung der React-, Worker- und Durable-Object-Hotspots wurde zusätzlich gegen aktuelle
Plattform-Best-Practices geprüft. Keine Empfehlung darf Gruppenschutz, Autorisierung, Idempotenz,
Concurrency, Auditierung, Outbox, Datenminimierung oder die Persist-before-publish-Invariante
abschwächen.
