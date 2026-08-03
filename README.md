# Rundflug-Leitstand

Aktueller Applikations- und Anforderungsstand: **1.12.0 (Dokumentations- und Freigabephase)**.

In Entwicklung befindliche V1 eines webbasierten Operations-Management-Systems zur Organisation
von Rundflügen auf Flugplatzfesten und Fly-Ins. Der aktuelle Stand läuft als nicht produktive
Cloudflare-Abnahmeumgebung; die Produktivfreigabe erfolgt erst nach vollständiger V1-Abnahme.

Das Repository enthält die konsolidierten Anforderungen, Traceability, Architekturentscheidungen,
React-PWA, Cloudflare Worker, D1-/Durable-Object-Kommandoverarbeitung, R2-Sicherung sowie ausführbare
Qualitätsprüfungen. Kasse, Flight Line, Administration, öffentliche Monitore, anonymer QR-Status,
Web-Push, aktiver Gruppennachruf, Offline-Überbrückung und Betriebsberichte sind als V1-Bausteine
vorhanden; noch offene Abnahmepunkte sind in `docs/requirements/traceability.csv` sichtbar.

Die Root-Version in `package.json` ist die gemeinsame Source of Truth für Anwendung, Pakete,
Laufzeitmetadaten und die aktuelle Requirements-/Traceability-Fassung.

## Zielarchitektur

- React 19 + TypeScript 7 + Vite als PWA-Frontend
- Cloudflare Worker als API und Auslieferung der statischen Assets
- D1 als relationale Source of Truth
- ein SQLite-basiertes Durable Object je Veranstaltung als serieller Kommando-Koordinator und
  WebSocket-Hub
- R2 für Sicherungen und Berichte
- Cloudflare Cron Triggers für Wartung, Löschung und spätere Backups
- plattformneutrale Domänenlogik in `packages/domain`

Die Entscheidung für diese Architektur ist in `docs/adr/` dokumentiert.
Ein datierter Vergleich mit kostengünstigen Alternativen liegt unter `docs/operations/provider-comparison.md`.
Fachmodell, Zustandsautomaten, Invarianten und Prognoseverfahren sind unter
`docs/architecture/domain-state-and-forecast-v1.md` zusammenhängend beschrieben.
Der erledigte und noch verbleibende Konsolidierungsbedarf steht in
[docs/architecture/technical-debt-1.11.0.md](docs/architecture/technical-debt-1.11.0.md).

## Voraussetzungen

- Node.js 22.22.2, 24.15.0 oder neuer innerhalb einer unterstützten geraden Hauptversion
- npm 12.0.2 oder neuer innerhalb der Hauptversion 12
- Python 3 für die Validierung des Anforderungskatalogs
- für Cloudflare-Deployments ein Cloudflare-Konto und `wrangler login`

## Lokaler Start

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Danach:

- Weboberfläche: `http://localhost:5173`
- Worker/API: `http://localhost:8787`
- Healthcheck: `http://localhost:8787/api/health`

Vite leitet `/api` und WebSocket-Verbindungen im Entwicklungsbetrieb an Wrangler weiter.

### Prognose-Simulator lokal und in der Abnahmeumgebung

Der lokale Prognose-Simulator benötigt weder Worker noch D1, Anmeldung oder Cloudflare-Ressourcen:

```bash
npm run simulator
```

Vite öffnet `http://127.0.0.1:5173/simulation`. Die Route ist ausschließlich im Vite-Modus
`simulator` aktiv, verarbeitet CSV- und JSON-Dateien nur im Browser und führt selbst keine
Netzwerkzugriffe aus.

Der normale Cloudflare-Build stellt dieselbe Oberfläche zusätzlich lazy unter `/simulation` bereit.
Sie wird aus **Administration → Auswertung** in einem neuen Tab geöffnet und durch die vorhandene
Anmeldung sowie die Rolle `ADMIN` geschützt. Die anfängliche Sitzungs- und Veranstaltungsauswahl
verwendet die bestehende API; Simulationskonfiguration, CSV-Inhalte, A/B-Vergleiche und Ergebnisse
bleiben danach vollständig im Browser und werden weder in D1 noch in Durable Objects, KV oder R2
gespeichert. Der Simulator erscheint bewusst nicht im allgemeinen Ansichtswechsler und wird nicht
für alle PWA-Installationen vorab gecacht.

Über **Administration → Auswertung → Simulationsgrundlage exportieren** kann eine sichere
JSON-Datei mit Tageszeiten, Stammdaten und noch offenen geplanten Unterbrechungen erstellt werden.
Der anschließende Import im Simulator legt eine lokale Variante an. Tickets, Queues, Ist-Zustände,
Ereignisverlauf, Audit und Prognosesnapshots sind nicht Teil der Datei. Varianten und synthetische
Läufe bleiben flüchtig im geöffneten Browser-Tab.

Im Simulator bündelt **Simulationsgrundlage laden** die vier eingebauten Szenarien und den
JSON-Import. Das gewählte Szenario kann im strikt validierten Format
`rundflug-simulation-scenario` Version 1 heruntergeladen, manuell bearbeitet und wieder als neue
Variante geladen werden. Die CSV-Kalibrierung bleibt davon getrennt.

Die vollständige Checkliste für Einrichtung, Betriebsbeginn und einen gestuften sicheren Neustart
steht in [docs/operations/betriebsstart-und-neustart.md](docs/operations/betriebsstart-und-neustart.md).

## Qualitätsprüfung

```bash
npm run check
```

Der Befehl führt Format-/Lintprüfung, Typprüfung, Tests, Web-Build, Worker-Dry-Run und die
Vollständigkeitsprüfung des Anforderungskatalogs aus.
Die aktuellen automatisierten Prüfungen sind in `package.json`, den Requirements und der
vollständigen Traceability dokumentiert.

## Cloudflare-Ressourcen

Die aktuell verwendete D1-Datenbank und der R2-Bucket sind in `wrangler.jsonc` gebunden. Neue,
getrennte Zielumgebungen werden namensgesteuert und in EU-Jurisdiktion gemäß
[Cloudflare-Neuaufbau](docs/operations/cloudflare-neuaufbau.md) sowie
[ADR-0027](docs/adr/0027-portable-cloudflare-ziele-und-reset-fortsetzung.md) erstellt.

Die für V1 erforderliche, telefonnummernfreie Browser-Benachrichtigung wird sicher eingerichtet mit:

```bash
npm run cloudflare:configure-push
```

Das Kommando erzeugt den privaten VAPID-Schlüssel nur im Arbeitsspeicher, überträgt ihn ohne
Ausgabe direkt als Cloudflare-Secret und bestätigt anschließend über Cloudflare, dass alle drei
erforderlichen Secret-Namen vorhanden sind.

Den Remote-Migrationsstand zeigt ausschließlich lesend:

```bash
npm run db:migrations:remote:status
```

Das Anwenden ausstehender Migrationen verändert die gebundene Cloudflare-D1 und erfolgt bewusst nur
als eigener, bestätigter Betriebsschritt:

```bash
npm run db:migrate:remote
```

## Repository-Struktur

```text
apps/web/                 React-PWA für operative, administrative und öffentliche Oberflächen
apps/worker/              Worker, API, Durable Object und D1-Migrationen
packages/contracts/       transportfähige Schemas und Kommandoverträge
packages/domain/          reine Fachlogik und Invarianten
packages/config/          gemeinsame Konstanten
packages/testkit/         synthetische Testdaten und Testuhr
docs/requirements/        Lastenheft, strukturierte Anforderungen und Traceability
docs/adr/                 Architekturentscheidungen
docs/operations/          Konto-, Deployment-, Backup- und Notfallhinweise
docs/roles/               aktuelle Rollenblätter und synthetische Screenshots
scripts/                   lokale Prüf- und Hilfsskripte
```

## Empfohlener Codex-Ablauf

1. `AGENTS.md` und die Anforderungen lesen lassen.
2. Aktuelle Traceability und offene Fragen prüfen.
3. Offene Fragen und ADRs fachlich freigeben.
4. Je Pull Request genau einen vertikalen, testbaren Baustein umsetzen.
5. Anforderungs-IDs in Issue, Commit, Test und Pull Request referenzieren.
6. Vor jedem Merge `npm run check` und ein unabhängiges Review durchführen.

## Vertraulichkeit

Die Lastenhefte sind als vertrauliche Projektunterlagen zu behandeln. Das Repository sollte zunächst
privat geführt werden. Produktionsdaten, Telefonnummern, öffentliche Ticket-Tokens, PINs und
Cloudflare-Secrets dürfen niemals committed werden.
