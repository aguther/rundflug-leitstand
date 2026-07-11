# Rundflug-Leitstand

Initiales, **noch nicht produktionsreifes** Repository für ein webbasiertes
Operations-Management-System zur Organisation von Rundflügen auf Flugplatzfesten und Fly-Ins.

Das Repository ist als kontrollierter Startpunkt für die weitere Umsetzung mit Codex angelegt. Es
enthält die konsolidierten Anforderungen, eine Traceability-Matrix, Architekturentscheidungen,
Cloudflare-Konfiguration, ein minimales React-Frontend, einen Worker mit D1- und Durable-Object-
Gerüst sowie ausführbare Qualitätsprüfungen.

> **Wichtig:** Die vorhandene Oberfläche ist ausschließlich ein technischer Startbildschirm. Kasse,
> Flight Line, FIDS, Ticketstatus, Offlinebetrieb, Benachrichtigungen und die fachlichen Workflows sind
> noch nicht implementiert.

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

## Qualitätsprüfung

```bash
npm run check
```

Der Befehl führt Format-/Lintprüfung, Typprüfung, Tests, Web-Build, Worker-Dry-Run und die
Vollständigkeitsprüfung des Anforderungskatalogs aus.
Die vor dem Verpacken ausgeführten Prüfungen sind in `docs/verification/initial-verification.md` festgehalten.

## Cloudflare-Ressourcen

Die IDs in `wrangler.jsonc` für Abnahme und Produktion sind Platzhalter. Ressourcen werden bewusst
nicht automatisch angelegt, damit Jurisdiktion, Kontoinhaberschaft und Namensgebung vor dem ersten
Deployment geprüft werden.

Beispiel für D1:

```bash
npx wrangler d1 create rundflug-leitstand-acceptance --jurisdiction=eu
npx wrangler d1 create rundflug-leitstand-production --jurisdiction=eu
```

Die von Wrangler ausgegebenen IDs werden in `wrangler.jsonc` eingetragen. R2-Buckets müssen ebenfalls
mit EU-Jurisdiktion angelegt werden. Die vollständige Anleitung steht in
`docs/operations/cloudflare-setup.md`.

## Repository-Struktur

```text
apps/web/                 React-PWA und technische Startoberfläche
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
