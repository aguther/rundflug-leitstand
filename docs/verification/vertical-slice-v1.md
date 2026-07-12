# Verifikation V1-Vertical-Slice Verkauf bis Abschluss

Stand: 12.07.2026

Der reproduzierbare Befehl `npm run test:vertical-slice` setzt ausschließlich synthetische lokale
Daten auf und führt den Standardablauf über HTTP, Worker, Event-Durable-Object und D1 aus.

Geprüft werden:

- Veranstaltung parametrisieren und aktivieren,
- gemeinsamer Verkauf von zwei Tickets in genau einer Buchungs-/Fluggruppe,
- idempotente Wiederholung desselben Verkaufskommandos ohne neue Version oder Dublette,
- Ablehnung eines neuen Kommandos mit veralteter `expectedVersion`,
- Vorschlag eines kompatiblen Flugzeugs und anonymen Pilotencodes,
- `NEXT → IM FLUG → GELANDET → ABGESCHLOSSEN`,
- getrennte Ist-Zeitpunkte für Boarding/Aufruf, Start, Landung und Abschluss,
- Flugzeugzustand `LANDED` nach Landung und erst `AVAILABLE` nach Abschluss.

Ergebnis am 12.07.2026: Verkauf `TICKET_GROUP_SOLD`, Dublette erkannt, stale write mit HTTP 409
abgelehnt, alle vier Zustandsereignisse bestätigt, zwei Tickets im selben Umlauf, alle Ist-Zeitpunkte
vorhanden und finale Event-Version 7.
