# Technische Schulden – Stand 1.12.0

Stand: 10. August 2026
Messbasis: `7230fccaa11abf2d05b5d9c52648a80a97089696` auf dem abschließend validierten
Integrationsstand

Dieses Dokument schreibt die Restschuldenliste aus
[`technical-debt-1.11.0.md`](technical-debt-1.11.0.md) fort. Es dokumentiert den Abschluss der
Analysepunkte 1.1, 1.2 und 2.1 bis 2.4 sowie die danach verbleibenden, priorisierten nächsten
Schnitte. Fachliche Invarianten, öffentliche Verträge und die Requirements 1.12.0 wurden dabei
nicht geändert; es war keine D1-Migration erforderlich.

## Aktueller Messstand

Die Ausgangswerte stammen aus dem für die Umsetzung festgelegten Stand
`5e1dce2572260b83be11ef92fe905d7e663c2674` beziehungsweise aus dem unmittelbar vor dem letzten
Guardrail-Schnitt erhobenen Testkopplungsstand. Zeilenzahlen werden mit
`npm run refactor:guardrails` bestimmt.

| Kennzahl | Ausgangsstand | Stand 1.12.0 |
|---|---:|---:|
| `apps/worker/src/event-coordinator.ts` | 12.571 Zeilen | **1.394 Zeilen** |
| `apps/worker/src/index.ts` | 8.277 Zeilen | **219 Zeilen** |
| `apps/web/src/admin-view.tsx` | 5.546 Zeilen | **663 Zeilen** |
| `packages/contracts/src/index.ts` | 3.793 Zeilen | **8 Zeilen** |
| vollständiger Dependency-Audit | 13 High, 2 Moderate | **0 Findings** |
| Produktionsabhängigkeiten | 0 Findings | **0 Findings** |
| `?raw`-Importvorkommen in Tests | 220 in 77 Testdateien | **200 in 65 Testdateien** |
| erlaubte Produktions-TS/TSX-`?raw`-Importe | 149 vor dem finalen Ratchet | **135** |
| `?raw`-Importe der vier Zieldateien | 13 vor dem finalen Schnitt | **0** |
| `.toContain(`-Assertions in Tests | 2.377 | **1.805** |

Die verbindlichen Zielgrößen sind damit erreicht. Alle neu erfassten Produktionsmodule liegen unter
1.500 Zeilen. Besonders nah an dieser Grenze liegen derzeit
`apps/worker/src/forecast-timeline-service.ts` mit 1.479 Zeilen und der Coordinator mit 1.394
Zeilen.

## Abgeschlossene Konsolidierung

### Refactoring-Leitplanken und Verhaltenstests

- `scripts/verify_refactor_guardrails.mjs` verhindert neue Produktions-TS/TSX-`?raw`-Importe und
  verlangt, dass jede entfernte Ausnahme sofort aus der Baseline verschwindet.
- Für `event-coordinator.ts`, Worker-`index.ts`, `admin-view.tsx` und den Contracts-Root-Barrel gilt
  zusätzlich ein absolutes Null-Verbot. Dieses Verbot kann nicht durch eine Baseline-Ausnahme
  umgangen werden.
- Die Dateibudgets sind auf die aktuellen Ist-Werte abgesenkt. Extrahierte Module besitzen eigene
  Ratchets; der neue `operational-note-command-service.ts` liegt beispielsweise bei 78 Zeilen.
- Der Operational-Note-Pfad wird über echte Rollenregeln und das beobachtbare D1-Batch-Verhalten
  geprüft. Audit, Idempotenzbeleg und Outbox werden gemeinsam persistiert; veröffentlicht wird erst
  nach erfolgreichem Batch.
- Zuweisungsempfehlungen, Leases, bestätigte Überholungen, Dispatch-Planung, Plan-Reset,
  Analyse-Snapshots und Teilflug-Suffixe bleiben durch Domain-, DOM-, Worker-Runtime- und
  Integrationsprüfungen abgesichert.

### Entwicklungsabhängigkeiten

Der Lockfile wurde mit npm 12.0.2 erneuert. Die direkten Werkzeuge verwenden unter anderem Vite
8.2.1, `@cloudflare/vitest-pool-workers` 0.20.3, Wrangler 4.120.0 und `vite-plugin-pwa` 1.3.0.
Der eng begrenzte `fast-uri`-Override steht auf 3.1.5; ein erzwungenes Audit-Major-Upgrade wurde
nicht eingesetzt.

Für den tatsächlich integrierten Lockfile melden sowohl

- `npm audit --omit=dev` als auch
- `npm audit --audit-level=moderate`

null bekannte Findings.

### Kommando-Präambel

Produktionsakteure werden aus den vom authentifizierten Worker-Transport gesetzten Headern
übernommen. Die Abfrage und das `last_seen_at`-Update von `paired_devices` bleiben ausschließlich im
unveränderten Legacy-Entwicklungspfad.

Nach der Akteursauflösung lädt der Produktionspfad Idempotenzbeleg, Veranstaltung, optionale
Aggregatversion, Planbezug, Assistenz-Claim und gegebenenfalls die Umlaufzuordnung in genau einem
`D1Database.batch()`. `command-preflight-service.ts` prüft den Idempotenzbeleg aus diesem Batch und
führt nur bei einem weiterhin aktiven Claim einen zweiten D1-Aufruf für dessen Verlängerung aus. Ein
Adaptertest zählt deterministisch einen Batch und höchstens eine Claim-Verlängerung; ein gespeicherter
Beleg wird ohne weiteren D1-Aufruf als Wiederholung geliefert. Fehlerpriorität, Rollenprüfung,
erwartete Version, Planvalidierung und Claim-Abweisung bleiben unverändert.

Langsame Präambeln loggen ausschließlich Command-Typ, Dauer, Batch-, Statement- und die gezählte
Anzahl vertrauenswürdiger D1-Aufrufe. Die Gesamtdauer wird über privacy-neutrale `Server-Timing`-Phasen
und bei langsamen Kommandos nur als Queue- und Ausführungsdauer erfasst. IDs, Tokens, PINs und
personenbezogene Inhalte werden nicht protokolliert. Korrektheitsrelevante Arbeit wurde nicht in
`waitUntil()` verschoben.

### Worker, Coordinator, Contracts und Administration

- Der Durable Object Coordinator bleibt Serialisierer, Orchestrator und Realtime-Endpunkt. Seine
  Kommandofamilien, Prognose, Realtime- und Persistenzteile sind in einzeln budgetierte Services
  extrahiert.
- Der Worker-Einstieg enthält nur noch Bootstrap, Middleware, Bindings und Routenregistrierung.
  Öffentliche, Auth-, Admin-, Operations-, Analyse-/Berichts- und Backup-/Restore-Routen liegen in
  getrennten Modulen und Services.
- `packages/contracts` ist nach Auth/Veranstaltung, Tickets/Public Status, Operations/Dispatch,
  Prognose/Analyse, Stammdaten und Reports/Recovery geschnitten. Der achtzeilige Root-Barrel bleibt
  kompatibel; Subpath-Exports stehen ergänzend bereit.
- Die ADR-Folge ist eindeutig: Zeitmodell `0030`, skalierbare Prognose `0033`, eigenständiger
  Gruppennachruf `0038` und kontobezogene FIDS-Modi `0039`. Die bewusst eingefrorene
  Migrationsdublette wurde nicht verändert.
- `AdminView` ist mit 663 Zeilen eine Kompositions- und Navigationsschicht. Featurezustände liegen in
  lokalen Hooks und Reducern; eine neue globale Store-Abhängigkeit wurde nicht eingeführt.
  Parameter, Operations, Plan, Übersicht, Abschluss, Stammdaten und Shell-Dialoge besitzen
  eigenständige DOM- beziehungsweise Hook-Verhaltenstests.

### Realtime-Fan-out

Der gemeinsame Scheduler unter `apps/web/src/app/realtime-refresh-scheduler.ts` erzeugt einmal pro Tab
einen nicht persistierten Zufallsversatz. Operative Clients verwenden 25 bis 200 ms, öffentliche
Clients 150 bis 750 ms. Bursts werden auf die höchste `eventVersion` zusammengeführt; pro Client läuft
höchstens ein Refresh, und eine währenddessen eingetroffene neuere Version erzeugt genau einen
Folgeabruf. Initiales Laden, Reconnect und manuelle Aktualisierung bleiben unverzögert. Überholte
Antworten dürfen keinen neueren Zustand überschreiben.

Der deterministische Fan-out-Test simuliert getrennt 20 operative und 50 öffentliche Clients. Er
prüft verteilte Requeststarts, Single-Flight-Verhalten und die Übernahme der neuesten Version
innerhalb von einer Sekunde zuzüglich 40 ms synthetischer Serverantwortzeit. Der Nachweis ist damit
vom früheren Parallel-HTTP-Lesetest getrennt.

Der geschützte Live-Transport übernimmt die Autorisierung der WebSocket-Verbindung selbst. Die
allgemeine Control-Middleware lässt deshalb neben den FIDS-Abfragen auch den Live-Pfad bis zu diesem
Transport passieren. Dadurch erhalten angemeldete Display-Konten Realtime-Aktualisierungen, während
fehlende Produktionssitzungen weiterhin am Transport abgewiesen werden. Ein Middleware-
Regressionstest und der Browsernachweis sichern diesen Fall ab.

## Assetgrenzen

Der Produktionsbuild erzeugt ein Vite-Manifest. `scripts/verify_web_assets.mjs` berechnet
routentransitive Erstladegrößen aus der vollständigen Manifest-Abhängigkeitsmenge und vergleicht sie
mit dem eingecheckten Snapshot von `5e1dce` sowie den festen Budgets.

| Asset | Stand 1.12.0 roh | Stand 1.12.0 gzip | Budget roh | Budget gzip |
|---|---:|---:|---:|---:|
| globales CSS | 115,28 KiB | 21,45 KiB | 120 KiB | 24 KiB |
| Flight-Line-CSS | 98,97 KiB | 15,60 KiB | 100 KiB | 18 KiB |
| Admin-Route-Entry | 126,41 KiB | 35,89 KiB | 180 KiB | 48 KiB |
| Haupt-Entry | 206,71 KiB | 64,56 KiB | 215 KiB | 68 KiB |
| größter JavaScript-Chunk | 348,03 KiB | 100,05 KiB | 360 KiB | 105 KiB |
| gesamter PWA-Precache | 1.414,30 KiB | – | 1,60 MiB | – |

Alle neun geprüften Routen bleiben mit ihrer transitiven Erstladegröße innerhalb des jeweiligen
Ausgangssnapshots plus zwei Prozent. Analyse- und Diagrammflächen sowie Admin-Teilflächen werden nur
auf den benötigten Routen beziehungsweise Zuständen geladen. Globales, Admin-, Flight-Line-, FIDS-
und Simulations-CSS besitzen getrennte Auslieferungsgrenzen.

## Abnahmenachweise

Der abschließende Prüflauf auf dem integrierten Inhalt wurde mit npm 12.0.2 ausgeführt:

- `npm run check`: erfolgreich, darunter 287 Unit-/DOM-Testdateien mit 1.538 Tests, 23
  Worker-Runtime-Tests, alle V1-Integrationsszenarien, der V1-Abnahmetag, Analyse-Skalierung,
  Backup/Restore, Builds, Dokumentation und Requirements-Verifikation.
- Assetbudgets und alle routentransitiven Zwei-Prozent-Grenzen: erfolgreich.
- Produktions- und vollständiger Dependency-Audit: jeweils 0 Findings.
- Admin und FIDS wurden bei 1440×1000, 1024×768 und 430×900 jeweils in Light und Dark geprüft. Die
  lazy geladene Admin-Auswertung und der FIDS-Einstellungsdialog wurden dabei interaktiv geöffnet;
  ein horizontaler Dokumentüberlauf wurde nicht festgestellt. Ein abschließender deterministischer
  Browserlauf verzögerte den Admin-Analyse-Chunk gezielt und maß Pending- sowie Inhaltszustand bei
  1440×1000 Light und 430×900 Dark. Navigation, Seitenkopf, Aktionsgruppe und Workspace-Ursprung
  bewegten sich jeweils um 0 px; die Layout-Shift-Summe blieb bei 0. Der FIDS-Dialog veränderte Board,
  Kopf und Fuß ebenfalls um 0 px, blieb in beiden Viewports vollständig sichtbar und verband den
  Realtime-WebSocket erfolgreich. Die spätere Guardrail- und Preflight-Bereinigung änderte keinen
  produktiven UI-Code und erforderte deshalb keine Wiederholung der übrigen Viewports.

## Verbleibende Schulden

| Priorität | Befund | Nächster sicherer Schnitt |
|---|---|---|
| Mittel | Der Coordinator liegt mit 1.394 Zeilen unter, aber nahe seiner Grenze von 1.500 Zeilen. Der umfangreichste verbleibende zusammenhängende Pfad ist der Ticketverkauf. | `SELL_TICKET_GROUP` als `ticket-sale-command-service.ts` extrahieren. Produkt-/Kapazitätsabfrage, paralleles Hashing, atomarer Persistenzbatch, Attribution und privacy-neutrale `Server-Timing`-Phasen gemeinsam verschieben und über den bestehenden Sale-Guards- sowie Scale-HTTP-Nachweis absichern. |
| Mittel | `forecast-timeline-service.ts` liegt mit 1.479 Zeilen unmittelbar an der allgemeinen Modulgrenze. | Reine Timeline-Projektion und historische Kalibrierung in getrennte Worker-Adapter schneiden; Domainregeln und Ereignisreihenfolge unverändert lassen. |
| Mittel | 135 ältere Produktions-TS/TSX-`?raw`-Importe und 1.805 `.toContain(`-Assertions bestehen außerhalb der vier gesperrten Zieldateien fort. | Den bestehenden Ratchet beibehalten und bei jeder Änderung zuerst die hoch frequentierten Worker-, Kassen- und Flight-Line-Quelltexttests durch DOM-, HTTP- oder Runtime-Verhalten ersetzen. Keine pauschale Entfernung legitimer Artefakt- oder Textprüfungen. |
| Mittel | `master-data-command-service.ts` umfasst 1.300 und `operations-routes.ts` 1.043 Zeilen. | Stammdatenfamilien nach Gate/Produkt und Ressource/Flugzeug trennen; Operations-Routen weiter auf Transport und Response-Mapping reduzieren. |
| Mittel | Haupt-Entry, Flight-Line-CSS und größter JavaScript-Chunk besitzen nur noch begrenzten Abstand zu ihren harten Budgets. | Bei neuen Diagramm- oder Flight-Line-Funktionen routentransitive Manifestwerte vor und nach der Änderung vergleichen; schwere Analysebausteine weiterhin lazy laden und keine globale CSS-Rückverlagerung zulassen. |
| Niedrig | Historisch existiert die Migrationsnummer `0036` zweimal. Die Dateien sind bereits angewandt und dürfen nicht umbenannt werden. | Das automatisch erzeugte Migrationsregister und die Eindeutigkeitsprüfung beibehalten; neue Migrationen ausschließlich mit der nächsten freien Nummer anlegen. |

## Leitplanken für weitere Schnitte

Kein Größen-, Testkopplungs- oder Performanceziel rechtfertigt Änderungen an Gruppenschutz,
Autorisierung, Idempotenz, erwarteter Version, Concurrency, Auditierung, Outbox, atomarer
Persistenzgrenze, öffentlicher Datenminimierung oder Reihenfolge fachlich sichtbarer Ereignisse.
D1 bleibt relationale Source of Truth; Realtime-Veröffentlichung erfolgt weiterhin erst nach
erfolgreicher Persistenz.
