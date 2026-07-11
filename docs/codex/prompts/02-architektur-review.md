# Codex-Prompt 02 – Cloudflare-Architektur prüfen

```text
Arbeite im Plan-Modus und ändere zunächst keinen Code.

Ziel:
Prüfe die Cloudflare-native Zielarchitektur dieses Repositories gegen Lastenheft v1.4 und die
Betriebsbedingungen eines Flugplatzfests.

Verbindliche Ausgangspunkte:
- React/Vite PWA
- Cloudflare Worker mit Static Assets
- D1 als Source of Truth
- SQLite-basiertes Durable Object je Veranstaltung als Kommando-Koordinator und WebSocket-Hub
- EU-Jurisdiktion für D1, Durable Objects und R2
- IndexedDB-basierte Offline-Kommando-Queue
- Idempotenz-ID und Expected-Version je Kommando
- getrennte Abnahme- und Produktionsressourcen
- plattformneutrales packages/domain

Prüfe insbesondere:
1. Transaktions- und Fehlergrenzen von D1-Batches.
2. Verhalten bei Durable-Object-Neustart, WebSocket-Wiederverbindung und D1-Störung.
3. sichere Geräteauthentifizierung und Widerruf.
4. öffentliche Ticketcode-Sicherheit und Rate Limiting.
5. EU-Datenhaltung und noch offene Verarbeitungslokation.
6. Backup, Wiederherstellung und 14-Tage-Aufbewahrung.
7. Kostenfallen durch Polling, Logs, D1-Fullscans und nicht hibernierende WebSockets.
8. Anbieterwechsel und Portabilität.

Ergebnis:
- konkrete Findings nach Schweregrad,
- erforderliche ADR-Ergänzungen,
- vorgeschlagene Änderungen an Repository und Tests,
- keine Feature-Implementierung.
```
