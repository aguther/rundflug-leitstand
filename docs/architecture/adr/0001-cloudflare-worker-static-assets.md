# ADR-0001: Cloudflare Worker mit Static Assets statt reinem Pages-Projekt

- Status: Akzeptiert
- Datum: 2026-07-11

## Kontext

Die Anwendung benötigt API-Kommandos, D1, Durable Objects, WebSockets, Cron Trigger und eine statische
React-PWA. Ein reines Pages-Projekt würde für Durable-Object-Erstellung und Cron zusätzliche Worker
benötigen.

## Entscheidung

Frontend und API werden als ein Cloudflare Worker mit Static Assets betrieben. Vite erzeugt die
statischen Assets; der Worker verarbeitet `/api/*` und liefert ansonsten die SPA aus.

## Folgen

- ein Deployment und eine Domain
- Cloudflare-native Realtime- und Cron-Funktionen
- lokale Entwicklung benötigt Vite plus Wrangler
- Cloudflare-spezifische Adapter müssen vom Domain-Paket getrennt bleiben
