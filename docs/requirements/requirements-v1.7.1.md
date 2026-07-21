# Release 1.7.1 – Stabile Flight-Line-Bedienung und technischer Umlaufabbruch

Diese funktionale Ausbaustufe gehört zum Applikationsrelease `1.7.1`. Sie übernimmt V1.7.0 und
die fortgeltenden Kataloge V1.4 bis V1.6.1. Neuere Festlegungen dieses Dokuments ersetzen für
Assist und Supervisor die bisherige Oberflächenanordnung. FIDS sowie der Kassenablauf bleiben
fachlich unverändert.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V171-REL-010 | Applikation, Workspace-Pakete, Requirements, Traceability und UI-Konzepte verwenden konsistent Version `1.7.1`. | MUSS |
| V171-HEAD-010 | Alle authentifizierten Ansichten außer FIDS verwenden eine einzeilige Kopfzeile. Der geschlossene Ansichtsumschalter zeigt nur das aktuelle Icon; das Menü zeigt Icons und vollständige Namen. Der Veranstaltungsname wird nur bei ausreichendem Platz gezeigt. | MUSS |
| V171-TIM-010 | Assist und Supervisor verwenden dieselbe stabile Zeitlinie in der Reihenfolge Verfügbar, Boarding, Off-Block, On-Block, Nicht verfügbar. Nur Boarding bis On-Block ist verbunden; Marker und Linien liegen auf einer Achse, fehlende Zeiten sind geometrieneutral und es gibt keine Status-Hintergrundfläche. | MUSS |
| V171-AST-010 | Assist zeigt die Zeitlinie ausschließlich im festen, intern scrollbareren Tabblock Aktueller Umlauf/Historie. Pilotencode und kompakte Wechselaktion stehen ohne Präfix und Umbruch in einer Zeile. | MUSS |
| V171-ACT-010 | Häufige Flugstatusaktionen werden als gleich große, zugängliche Icon-Buttons ohne mobile Textbeschriftung dargestellt. Statuswechsel verändern weder Aktionshöhe noch Zeilenhöhe. | MUSS |
| V171-CLM-010 | Eine Flugzeugübernahme gehört zum pseudonymen Operator-Login, gilt 30 Minuten ab letzter Nutzung und wird bei aktiver Nutzung erneuert. Andere Logins erhalten Eigentümercode und Revision; eine bestätigte revisionierte Übernahme wird serialisiert, auditiert und veröffentlicht. | MUSS |
| V171-ABT-010 | Das atomare Kommando `ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE` ist während Boarding und nach Off-Block, nicht aber nach On-Block zulässig. Es verlangt einen Grund, stellt alle ungeteilten Gruppen in stabiler Reihenfolge als Block an den Queue-Anfang, erhält Anwesenheit, löst Flugzeug und Pilot vom DRAFT-Umlauf und setzt das Flugzeug `INACTIVE`. | MUSS |
| V171-PAU-010 | Der Pausendialog enthält ausschließlich 10, 20, 30 Minuten, Dauer unbekannt und Abbrechen. Eine Auswahl startet unmittelbar; freie Minuteneingabe und zusätzlicher Bestätigungsschritt entfallen. | MUSS |
| V171-SUP-010 | Die Supervisor-Tabelle enthält weder Status noch Nächster Schritt. Pilotverwaltung liegt in der Pilotspalte, die aktuelle Zeitlinie in jeder stabil hohen Flugzeugzeile und die flugzeugbezogene Historie in einem zentralen Dialog. Der frühere untere Umlauf-/Historienblock entfällt. | MUSS |
| V171-TKT-010 | Verkaufte Ticketgruppen nutzen die frei gewordene Breite und sind nach tatsächlichem Verkaufszeitpunkt absteigend, bei Gleichstand nach ID absteigend sortiert. Die bestehende Suche bleibt erhalten. | MUSS |
| V171-MSG-010 | Erwartete lokale Standardaktionen erzeugen keine Erfolgstoasts. Fehler, Konflikte, nicht ausführbare Aktionen und außergewöhnliche externe Änderungen einschließlich Fremdübernahme bleiben sichtbar. | MUSS |
| V171-QA-010 | Automatisierte Prüfungen und Browserabnahme decken 375×667, 390×844, 430×932 und 1440×900 ab und prüfen insbesondere Umbrüche, Dialogbeschnitt, Timeline-Achse, stabile Höhen, Claims, Abbruchatomarität und Meldungen. | MUSS |

## Persistenz und Wiederherstellung

Migration `0039_operator_owned_flight_line_claims.sql` verwirft bewusst die kurzlebigen
gerätegebundenen Claims, baut die Claim-Tabelle loginbasiert neu auf und ergänzt eine
Flugzeugversion für aggregatspezifische Konfliktprüfung. Vor Anwendung ist eine portable
D1-Sicherung anzulegen. Wiederherstellung erfolgt per D1 Time Travel oder Sicherung; ein Rollback
auf den alten Worker setzt die alte Claim-Tabelle aus der vorherigen Migration voraus. Operative
Umlauf-, Ticket-, Queue-, Flugzeug-, Audit-, Idempotenz- und Outbox-Änderungen des technischen
Abbruchs werden in einer gemeinsamen D1-Batchgrenze persistiert.

## Abnahme

- Technischer Abbruch aus `CALLED` und `IN_FLIGHT`, Ablehnung aus `LANDED`, mehrere Gruppen,
  erhaltene Anwesenheit, Queue-Verschiebung, Idempotenz sowie stale Event-/Umlauf-/Flugzeugversion.
- Gleiches Login auf mehreren Sitzungen, konkurrierendes Login, Ablauf, Erneuerung, bewusste
  Übernahme, stale Claim-Revision und sichtbarer Claim-Verlust beim bisherigen Betreuer.
- Assist und Supervisor in den festgelegten mobilen und Desktop-Viewports einschließlich Pause-,
  Übernahme-, Abbruch- und Historien-Dialog.
- FIDS und die Suchfeld-Leerfunktion bleiben unverändert.
