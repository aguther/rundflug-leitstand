# Codex-Prompt 03 – Technisches Fundament härten

```text
Ziel:
Härte ausschließlich das technische Fundament des Rundflug-Leitstands. Implementiere noch keinen
vollständigen Kassen-, Queue- oder Flight-Line-Prozess.

Kontext:
- Lies AGENTS.md und alle freigegebenen ADRs.
- Das vorhandene Repository ist ein Startgerüst und darf verbessert werden.

Umfang:
- Workspace- und TypeScript-Konfiguration
- React/Vite-PWA
- Cloudflare Worker und Hono-Routing
- lokale D1-Migrationen
- Durable-Object-WebSocket-Hibernation
- Idempotenz- und Expected-Version-Gerüst
- append-only Event-Ledger-Schutz
- Outbox-Grundlage
- strukturierte Logs ohne PII
- CI, Tests und lokale Startbefehle
- sichere Fehlerantworten und Security Header
- Dokumentation der realen Cloudflare-Ressourcenerstellung

Einschränkungen:
- Keine vollständige Fachfunktion vortäuschen.
- Keine Secrets committen.
- Keine proprietäre Abhängigkeit außerhalb der freigegebenen Cloudflare-Zielarchitektur ergänzen.
- packages/domain bleibt frei von Cloudflare-Abhängigkeiten.

Fertig, wenn:
- npm run check erfolgreich ist,
- npm run db:reset:local und npm run dev dokumentiert funktionieren,
- ein WebSocket-Verbindungs- und Wiederverbindungstest vorhanden ist,
- ein doppeltes Kommando denselben gespeicherten Response liefert,
- ein stale write als 409 abgelehnt wird,
- README und AGENTS.md nur tatsächlich vorhandene Befehle nennen.
```
