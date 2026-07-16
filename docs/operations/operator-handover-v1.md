# Betreiberübergabe und Providerwechsel V1

Status: Technischer Übergabeweg und Drittanbieter-Lizenzinventar dokumentiert;
Nutzungsrechts-/Projektlizenzfreigabe ausstehend.

Betroffene Anforderungen: Q-WAR-010, Q-WAR-030, Q-WAR-040 und T-080.

## 1. Vollständiger Übergabeumfang

Dem neuen Betreiber werden mindestens übergeben:

- vollständiges Git-Repository einschließlich Historie, Tags und freigegebenem Commit,
- `package.json`, Lockfile und dokumentierte Node-/npm-Versionen,
- sämtliche TypeScript-Quellen, Tests, SQL-Migrationen und synthetischen Seeds,
- Anforderungen, ADRs, Traceability, Architektur-, Betriebs- und Wiederherstellungsdokumentation,
- `wrangler.jsonc` ohne Secrets sowie die Liste aller benötigten Bindings und Secret-Namen,
- letzter erfolgreicher `npm run check`-Nachweis,
- letzter portabler D1-/R2-Backupnachweis samt SHA-256-Prüfsumme,
- DNS-/Domainzuständigkeit, Cloudflare-Accountrollen und CI-/GitHub-Buildkonfiguration,
- Inventar externer Verträge, AVV/DPA, Subprozessoren und Push-Anbieter,
- geprüftes Drittanbieter-Lizenzinventar aus
  `docs/operations/third-party-licenses-v1.md`,
- offene Abweichungen, Migrationen und Abnahmeauflagen.

Nicht in Repository, Übergabeprotokoll oder Tickets kopiert werden Klartext-PIN, Bootstrap-Code,
VAPID-Privatschlüssel, API-Token, Gerätekopplungstoken oder öffentliche Ticketcodes.

## 2. Reproduzierbarer Neuaufbau

Ein neuer Betreiber muss aus einem frischen Checkout ohne Zugriff auf den bisherigen Build-Cache
ausführen können:

```bash
npm install
npm run check
```

Für Cloudflare werden anschließend D1 und R2 mit EU-Jurisdiktion neu angelegt, deren IDs in einer
betreiberspezifischen Konfiguration gebunden, alle Migrationen angewendet und Secrets interaktiv neu
erzeugt. Alte Secrets werden nicht übertragen, sondern rotiert. Die Ersteinrichtung erfolgt über
`/setup` oder ein verifiziertes portables Backup.

## 3. Datenportabilität

### D1/R2 innerhalb Cloudflare

1. Schreibstopp und UTC-Zeitpunkt protokollieren.
2. Portables JSON-Backup mit SHA-256 nach R2 erzeugen.
3. Objekt lokal beziehungsweise in das neue Betreiberkonto übertragen.
4. Backup ausschließlich in eine neue isolierte D1-Datenbank einspielen.
5. Fremdschlüssel, Mengen, Audit-Append-only-Regeln und Prüfsumme verifizieren.
6. Neuen Worker zunächst auf die isolierte Datenbank binden und Smoke-/Rollentest ausführen.
7. Erst danach DNS beziehungsweise Custom Domain umschalten.

Push-Abonnements sind bewusst nicht Teil des portablen Backups. Besucher müssen Web-Push nach einem
Betreiberwechsel neu aktivieren; so werden Browser-Endpunkte und Schlüssel nicht verdeckt
weitergegeben.

### Wechsel zu einem anderen Provider

Portable Bestandteile bleiben unverändert:

- `packages/domain`: reine Fachlogik und Invarianten,
- `packages/contracts`: Transport- und Zustandsverträge,
- `apps/web`: React/Vite-PWA und Service Worker,
- SQLite-kompatible Tabellen-/Indexlogik und portable JSON-/CSV-Daten,
- HTTP-/WebSocket-Schnittstellen und alle automatisierten Fachtests.

Zu ersetzende Cloudflare-Adapter:

| Cloudflare-Baustein | Benötigter Ersatz |
| --- | --- |
| Worker/Hono-Laufzeit | TypeScript-fähiger HTTP-Server oder Edge-Runtime |
| D1 | transaktionale SQLite-/PostgreSQL-Datenbank mit Constraints und Batchgrenze |
| Durable Object | genau-ein serieller Kommando-Koordinator je Veranstaltung samt WebSocket-Hub |
| R2 | S3-kompatibler Objektspeicher mit Metadaten/Lifecycle |
| Rate-Limit-Bindings | serverseitige verteilte Rate Limiter für öffentliche Codes und die PIN-geschützte Wiederherstellung des Administrationszugangs |
| Cron Trigger | täglich zuverlässig ausgeführter Scheduler |
| Workers Builds | CI/CD-Pipeline mit Build, Migration-Gate und Rollback |

Ein Ersatz darf Versionserwartung, Idempotenz, atomare Persistenz, append-only Audit, Outbox und
Realtime erst nach erfolgreicher Persistenz nicht abschwächen.

## 4. Kontrollierter Übergabeablauf

1. Verantwortliche beider Betreiber, Wartungsfenster und Rückfallentscheidung festhalten.
2. Deploy-/Migrationsfreeze setzen und ausstehende Kommandos abarbeiten.
3. Letzten Tagesbericht sowie portables Backup erzeugen und Restore in Isolation nachweisen.
4. Repository und Dokumentation auf Secret-/Personendatenfreiheit prüfen.
5. Neue Accounts, zwei Administratoren, 2FA, minimale CI-Rechte und Kostenwarnungen einrichten.
6. D1/R2/DO-Jurisdiktion, Worker, Domain, TLS, Rate Limit, Cron und Observability prüfen.
7. Neue PIN-, Bootstrap-, VAPID- und CI-Secrets interaktiv setzen.
8. Rollen-Smoke-Test für Administration, Kasse, Flight Line, FIDS und öffentlichen Ticketstatus
   durchführen.
9. Domain umschalten, mindestens 30 Minuten beobachten und alten Stand nur lesend bereithalten.
10. Nach Abnahme alte API-/CI-Token und Gerätekopplungen widerrufen; Lösch-/Vertragsnachweise
    abschließen.

## 5. Abnahmekriterien

- Frischer Checkout besteht `npm run check`.
- Ein portables Backup wird in eine leere Datenbank eingespielt und fachlich verifiziert.
- Keine erforderliche Fachregel existiert ausschließlich in Cloudflare-Dashboard-Konfiguration.
- Alle Secret-Namen sind bekannt, kein Klartextsecret ist Teil der Übergabeunterlagen.
- Der neue Betreiber kann selbst deployen, migrieren, sichern, wiederherstellen und zurückrollen.
- Domain, Git-Repository, Cloudflare-/Providerkonto und mindestens zwei Adminzugänge stehen unter
  Kontrolle des Auftraggebers beziehungsweise des benannten Betreibers.
- Nutzungsrechts-/Lizenztext und Übergabeprotokoll sind von den Berechtigten ausdrücklich
  freigegeben.

Der technische Nachweis schließt T-080 nicht allein. Die rechtsverbindliche Einräumung des
uneingeschränkten Nutzungsrechts und die Wahl eines Lizenztexts können nur die berechtigten Parteien
freigeben.
