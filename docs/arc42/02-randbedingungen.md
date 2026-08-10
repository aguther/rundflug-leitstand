# 2. Randbedingungen

## 2.1 Technische Randbedingungen

| Randbedingung | Ausprägung | Hintergrund |
| --- | --- | --- |
| Betriebsplattform | Cloudflare Workers, D1, Durable Objects, R2, Rate-Limiting-Bindings, Cron Triggers | ADR-0001, ADR-0002; kein eigener Server, kein Betriebssystembetrieb durch den Verein |
| Datenjurisdiktion | D1, R2 und Durable Objects werden mit EU-Jurisdiktion angefordert (`jurisdiction("eu")`, `DATA_JURISDICTION=eu`) | Q-DSG-040, ADR-0003; Restfragen zu Metadaten sind in OQ-06 offen |
| Sprache und Laufzeit | TypeScript 7.0.2 durchgängig, ES-Module, `nodejs_compat` | einheitliche Werkzeugkette für Domäne, Worker und Oberfläche |
| Node.js/npm | Node 24.18.0 als Standard, Node 22.22.2 als unterstützte Mindestversion, npm 12.0.2 | `.nvmrc`, `engines` in `package.json`, GitHub-Actions-Konfiguration |
| Frontend | React 19 + Vite als installierbare PWA, mehrere Web-App-Manifeste je Rolle | Tablet- und Monitorbetrieb, Offline-Sichtbarkeit |
| Endgeräte | Android- und iOS-Tablets, iPhone, Desktop 1366 × 768 und 1920 × 1080, dauerhaft laufende Monitore | Q-UX-090, Q-UX-100; iOS-Web-Push erfordert installierte PWA |
| Abhängigkeiten | quelloffene Standardbibliotheken, maschinengeprüfte Allowlist, keine Web-Push-Kryptobibliothek (native Web-Crypto-API) | Q-WAR-010; `apps/worker/src/maintainability-coverage.test.ts` |
| Datenhaltung | SQLite-kompatibles SQL, ausschließlich additive Migrationen mit Rollback-/Restore-Notiz | D1-Betriebsmodell, kein Wartungsfenster am Veranstaltungstag |
| Transport | HTTPS und WSS; keine externen Skripte, Fonts, Tracker oder Analysedienste (strikte CSP) | Q-SIC-010, Q-SIC-040 |
| Zeit | Persistenz in UTC, Anzeige in der IANA-Zeitzone der Veranstaltung (Standard `Europe/Berlin`) | Sommerzeitfehler in Berichten und Fristen vermeiden (R-09) |

## 2.2 Organisatorische Randbedingungen

| Randbedingung | Ausprägung |
| --- | --- |
| Betreiber | Verein mit ehrenamtlichem Betrieb; keine ständige IT-Bereitschaft am Veranstaltungstag |
| Budget | höchstens 15 Euro laufende Grundkosten je Monat ohne Mobilfunk- und Versandkosten (Q-WAR-030) |
| Umgebungen | genau eine Cloudflare-Abnahmeumgebung; die Produktivumgebung ist ein ausdrückliches Freigabe-Gate mit eigener D1, eigenem EU-R2-Bucket und getrennten Secrets (ADR-0007) |
| Freigabestand | 1.12.0 ist Abnahme-, nicht Produktivstand; `/api/meta` meldet `productionReady: false` |
| Änderungsprozess | Anforderungs-IDs in Commits, Tests und Traceability; ADR für jede strukturprägende Entscheidung |
| Arbeitsweise | ein fachliches Ergebnis je kurzlebigem Branch und Worktree, lineare Historie, Fast-forward nach `main` (`AGENTS.md`) |
| Veranstaltungstag | Change Freeze; keine Migration und keine Konfigurationsänderung ohne dokumentierten Rückfall (R-15) |

## 2.3 Konventionen

- **Sprachtrennung:** fachliche Artefakte (Anforderungen, ADRs, Betriebs- und Benutzerdokumentation,
  sichtbare Oberflächentexte) auf Deutsch; sämtliche technischen Bezeichner, Kommentare, Logmeldungen
  und Testnamen auf Englisch. Persistierte oder öffentliche Bezeichner werden nicht aus rein
  stilistischen Gründen umbenannt.
- **Code-Stil:** Biome als Formatter und Linter, zwei Leerzeichen Einrückung, Zeilenlänge 100,
  doppelte Anführungszeichen, Semikolons, LF-Zeilenenden (`biome.json`, `.editorconfig`).
- **Commits:** Conventional Commits in englischer Sprache, Anforderungs-IDs in der `Refs:`-Zeile.
- **Dokumentation:** ADRs unter `docs/adr/`, Betriebsanleitungen unter `docs/operations/`,
  Verifikationsnachweise unter `docs/verification/`, diese Architekturübersicht unter `docs/arc42/`.
- **Prüfbarkeit:** Architekturaussagen werden nach Möglichkeit durch ausführbare Prüfungen abgesichert
  (`npm run check`, `npm run docs:verify`, `npm run refactor:guardrails`).
