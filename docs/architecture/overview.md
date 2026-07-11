# Architekturübersicht

```text
Browser / PWA
├── Kasse
├── Flight Line
├── Administration / Flugleitung
├── FIDS / Boardingmonitor
└── öffentliche Ticketstatusseite
          │ HTTPS + WebSocket
          ▼
Cloudflare Worker
├── statische React-Assets
├── API und Geräteberechtigung
├── Kommandoannahme
├── Prognoseadapter
└── Cron-Handler
          │
          ├── Durable Object je Veranstaltung
          │   ├── serialisiert Schreibkommandos
          │   ├── prüft Idempotenz und erwartete Version
          │   └── verteilt bestätigte Live-Ereignisse
          │
          ├── D1
          │   ├── aktueller relationaler Zustand
          │   ├── append-only Event Ledger
          │   ├── Idempotenzbelege
          │   └── Outbox
          │
          └── R2
              ├── portable Backups
              ├── Tagesberichte
              └── CSV-/PDF-Exporte
```

## Konsistenzgrenze

Alle Schreibkommandos einer Veranstaltung werden über genau ein Durable Object geleitet. Das Durable
Object verhindert parallele, widersprüchliche Verarbeitung für dieselbe Veranstaltung. D1 bleibt die
Source of Truth; das Durable Object darf flüchtigen Cache halten, aber keinen ausschließlich dort
vorhandenen fachlichen Zustand.

## Realtime

WebSocket-Verbindungen werden mit Hibernation betrieben. Clients erhalten nach Wiederverbindung immer
zuerst einen vollständigen Snapshot und danach Ereignisse ab der bekannten Version. Polling ist nur ein
Fallback.

## Offline

Die PWA speichert den letzten bestätigten Snapshot und eine lokale Kommando-Queue in IndexedDB. Jedes
Kommando enthält `commandId`, `eventId`, `expectedVersion`, Geräteidentität und Zeitpunkt. Konflikte
werden sichtbar zurückgegeben und nicht automatisch überschrieben.
