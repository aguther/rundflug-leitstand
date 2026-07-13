# Rundflug-Leitstand

In Entwicklung befindliche V1 eines webbasierten Operations-Management-Systems zur Organisation
von Rundflügen auf Flugplatzfesten und Fly-Ins. Der aktuelle Stand läuft als nicht produktive
Cloudflare-Abnahmeumgebung; die Produktivfreigabe erfolgt erst nach vollständiger V1-Abnahme.

Das Repository enthält die konsolidierten Anforderungen, Traceability, Architekturentscheidungen,
React-PWA, Cloudflare Worker, D1-/Durable-Object-Kommandoverarbeitung, R2-Sicherung sowie ausführbare
Qualitätsprüfungen. Kasse, Flight Line, Administration, öffentliche Monitore, anonymer QR-Status,
Web-Push, Offline-Überbrückung und Betriebsberichte sind als V1-Bausteine vorhanden; noch offene
Abnahmepunkte sind in `docs/requirements/traceability.csv` sichtbar.

## Zielarchitektur

- React 19 + TypeScript + Vite als PWA-Frontend
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

## Voraussetzungen

- Node.js 22.12 oder neuer
- npm 10 oder neuer
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

Die vollständige Checkliste für Einrichtung, Betriebsbeginn und einen gestuften sicheren Neustart
steht in [docs/operations/betriebsstart-und-neustart.md](docs/operations/betriebsstart-und-neustart.md).

## Qualitätsprüfung

```bash
npm run check
```

Der Befehl führt Format-/Lintprüfung, Typprüfung, Tests, Web-Build, Worker-Dry-Run und die
Vollständigkeitsprüfung des Anforderungskatalogs aus.
Die vor dem Verpacken ausgeführten Prüfungen sind in `docs/verification/initial-verification.md` festgehalten.

## Cloudflare-Ressourcen

Die aktuell verwendete D1-Datenbank und der R2-Bucket sind in `wrangler.jsonc` gebunden. Beide
Ressourcen müssen in EU-Jurisdiktion liegen. Die vollständige Anleitung steht in
`docs/operations/cloudflare-setup.md`.

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
docs/codex/prompts/       direkt nutzbare Codex-Aufträge
docs/operations/          Konto-, Deployment-, Backup- und Notfallhinweise
scripts/                   lokale Prüf- und Hilfsskripte
```

## Empfohlener Codex-Ablauf

1. `AGENTS.md` und die Anforderungen lesen lassen.
2. Mit `docs/codex/prompts/01-plan-und-traceability.md` im Plan-Modus beginnen.
3. Offene Fragen und ADRs fachlich freigeben.
4. Je Pull Request genau einen vertikalen, testbaren Baustein umsetzen.
5. Anforderungs-IDs in Issue, Commit, Test und Pull Request referenzieren.
6. Vor jedem Merge `npm run check` und ein unabhängiges Review durchführen.

## Vertraulichkeit

Die Lastenhefte sind als vertrauliche Projektunterlagen zu behandeln. Das Repository sollte zunächst
privat geführt werden. Produktionsdaten, Telefonnummern, öffentliche Ticket-Tokens, PINs und
Cloudflare-Secrets dürfen niemals committed werden.
