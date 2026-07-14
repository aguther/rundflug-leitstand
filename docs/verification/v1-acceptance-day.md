# Automatisierter V1-Abnahmetag

Status: Erfolgreich am 14. Juli 2026.

Backlogbezug: BP-12 und Abnahmeszenario aus Kapitel 13.2 der Anforderungen.

`npm run test:v1-acceptance-day` setzt eine ausschließlich lokale D1-Testdatenbank neu auf, startet
genau einen lokalen Worker und bedient die realen HTTP-, Kommando-, Durable-Object-, Persistenz- und
Auditpfade. Der Datensatz ist vollständig synthetisch und anonym:

- drei Flugzeuge,
- zwei Ressourcengruppen,
- drei Produkte, davon zwei in derselben Ressourcengruppe,
- drei technische Pilotencodes,
- je ein Administrations-, Kassen- und Flight-Line-Gerät,
- 20 Ticketgruppen mit zusammen 60 QR-Tickets.

Alle 20 Umläufe werden in Queue-Reihenfolge aufgerufen, mit Flugzeug und Pilotencode bestätigt,
gestartet, gelandet und erst danach abgeschlossen. Der Test bricht bei jedem HTTP-Fehler, veralteten
Schreibstand oder verletzten Endzustand ab.

## Ergebnis

Der vollständige Lauf war erfolgreich:

```json
{
  "ok": true,
  "dataset": {
    "aircraft": 3,
    "resourceGroups": 2,
    "products": 3,
    "tickets": 60,
    "rotations": 20
  },
  "eventVersion": 100
}
```

Zusätzlich wurden folgende fachliche Endzustände direkt aus dem bestätigten Operationsstand und
dem append-only Ereignisverlauf geprüft:

- exakt 60 verkaufte Tickets,
- exakt 20 abgeschlossene und keine aktiven Umläufe,
- alle 60 Tickets im Zustand `COMPLETED`,
- alle Umläufe mit genau drei zusammengehörigen Tickets,
- je 20 Auditereignisse `TICKET_GROUP_SOLD`, `FLIGHT_GROUP_CALLED`, `ROTATION_STARTED`,
  `ROTATION_LANDED` und `ROTATION_COMPLETED`,
- alle drei Testflugzeuge nach dem Abschluss wieder `AVAILABLE`.

## Abgrenzung

Dieser reproduzierbare technische Abnahmetag erfüllt den automatisierbaren Mengengerüstteil von
BP-12. Er ersetzt weder den laufenden ungekürzten 12-Stunden-Nachweis noch die Generalprobe mit
Originalhardware, realen Browsern, Helferrollen, Kiosk und Web-Push am Veranstaltungsort.
