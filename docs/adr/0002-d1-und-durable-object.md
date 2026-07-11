# ADR-0002: D1 als Source of Truth, Durable Object als serieller Koordinator

- Status: Akzeptiert
- Datum: 2026-07-11

## Entscheidung

D1 speichert den relationalen Zustand, das append-only Event Ledger, Idempotenzbelege und Outbox.
Genau ein SQLite-basiertes Durable Object je Veranstaltung serialisiert Schreibkommandos und betreibt
die Live-WebSockets.

## Regeln

- Kein fachlicher Zustand darf ausschließlich im Durable Object existieren.
- Jeder Client sendet `commandId` und `expectedVersion`.
- Realtime wird erst nach bestätigter D1-Persistenz ausgesendet.
- Nach Neustart rekonstruiert das Durable Object seinen Snapshot aus D1.
- Alle alternativen Schreibpfade an D1 sind verboten oder müssen dieselbe Koordinationsgrenze nutzen.
