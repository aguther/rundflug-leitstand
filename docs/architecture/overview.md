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

## Öffentlicher Ticketzugriff

Öffentliche Statusabfragen verwenden ausschließlich den SHA-256-Hash des kryptografisch zufälligen
Ticketcodes als D1-Schlüssel. Unbekannte und syntaktisch ungültige Codes liefern dieselbe neutrale
Antwort. Nach 30 unbekannten Codes je 60 Sekunden und anfragendem Akteur weist die Cloudflare-
Rate-Limiting-Bindung weitere Versuche mit HTTP 429 ab. Als flüchtiger Zählerschlüssel wird nur ein
SHA-256-Hash der von Cloudflare bereitgestellten Akteursadresse verwendet; Adresse und Hash werden
weder in D1 noch im Audit-Ledger oder in Anwendungslogs gespeichert. Erfolgreiche Statusabrufe
verbrauchen dieses Fehlversuchslimit nicht.

## Offline

Die PWA speichert den letzten bestätigten operativen Snapshot je Veranstaltung und Gerät in IndexedDB.
Bei einem Ausfall oder nach einem Offline-Neustart bleibt dieser Stand sichtbar und wird mit dem Alter
der letzten Serverbestätigung als möglicherweise veraltet gekennzeichnet. Vorbereitende, lokal
reversible Kassenentwürfe wie Produktauswahl und Gruppengröße bleiben lokal erhalten.

Operativ wirksame Kommandos werden gemäß OQ-01 nicht offline angenommen: Verkauf, Storno, Umbuchung,
`NEXT`, `IM FLUG`, `GELANDET`, `ABGESCHLOSSEN`, Not-Halt und Stammdatenänderungen benötigen eine
Serverbestätigung. Sie werden bei fehlender Verbindung gesperrt statt scheinbar erfolgreich in eine
lokale Fachkommando-Queue gestellt. Bestätigte Kommandos enthalten weiterhin `commandId`, `eventId`,
`expectedVersion`, Geräteidentität und Zeitpunkt; Konflikte werden sichtbar zurückgegeben und nicht
automatisch überschrieben.
