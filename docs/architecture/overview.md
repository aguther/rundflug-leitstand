# Architekturübersicht

Die detaillierte Beschreibung des Fachmodells, aller V1-Zustandsautomaten, technischen Invarianten
und des Prognoseverfahrens steht in
[`domain-state-and-forecast-v1.md`](domain-state-and-forecast-v1.md).

```text
Browser / PWA
├── Kasse
├── Flight Line Supervisor (Desktop)
├── Flight Line Assist (Mobilgerät)
├── kompakte Administration
├── Standard-FIDS / Boardingmonitor
├── Terminal-FIDS (vollständig Englisch)
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
Fallback. Bei einem Server- oder D1-Fehler bleibt der letzte bestätigte Snapshot sichtbar und wird mit
Alter und Störungsstatus gekennzeichnet. Schreibaktionen bleiben bis zu einer neuen
Serverbestätigung gesperrt; ein Fehler leert den sichtbaren Stand nicht.

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
reversible Kassenentwürfe wie Produktauswahl und Gruppengröße werden veranstaltungs- und
gerätebezogen in einer auf 50 Revisionen begrenzten lokalen Draft-Queue gehalten. Sie sind sichtbar
als ausstehend und ohne operative Wirkung gekennzeichnet. Nach Wiederverbindung werden sie nicht
automatisch gesendet: Die Kasse prüft den Entwurf und bestätigt den Verkauf bewusst gegen die aktuelle
Serverversion; erst nach erfolgreicher Bestätigung wird die Draft-Queue geleert.

Operativ wirksame Kommandos werden gemäß OQ-01 nicht offline angenommen: Verkauf, Storno und der
bewusste Neuverkauf nach einer Korrektur,
„Belegung bestätigen & Boarding starten“, `IM FLUG`, `GELANDET`, `ABGESCHLOSSEN`, Not-Halt und Stammdatenänderungen benötigen eine
Serverbestätigung. Sie werden bei fehlender Verbindung gesperrt statt scheinbar erfolgreich in eine
lokale Fachkommando-Queue gestellt. Bestätigte Kommandos enthalten weiterhin `commandId`, `eventId`,
`expectedVersion`, Geräteidentität und Zeitpunkt; Konflikte werden sichtbar zurückgegeben und nicht
automatisch überschrieben.
