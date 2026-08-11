# ADR-0040: Serverseitige Vergabe öffentlicher Statuscodes

- Status: Akzeptiert
- Datum: 2026-08-11
- Entscheidung: Technische Härtung einer bestehenden Sicherheitsinvariante
- Betroffene Anforderungen: F-KAS-050, D-030, Q-SIC-030, V18-GRP-010 und V18-DAT-010

## Kontext

Öffentliche Ticket- und Gruppencodes müssen nicht erratbar sein. Bislang erzeugte die offizielle PWA
starke Zufallscodes, der Vertrag für `SELL_TICKET_GROUP` akzeptierte aber auch frei gewählte formal
gültige Codes. Ein manipulierter authentifizierter Kassenclient hätte daher schwache oder
vorhersagbare Codes einreichen können. Der nachgelagerte SHA-256-Hash schützt einen schwachen
Klarwert nicht vor Aufzählung.

Die Codes sind gleichzeitig Teil des bestätigten Kassenbelegs. Eine idempotente Wiederholung muss
deshalb exakt die zuerst persistierten Werte liefern und darf keine neuen Codes erzeugen.

## Entscheidung

- Ein reguläres Online-Verkaufskommando übermittelt nur Produkt, Ticketanzahl, optionale
  Ticketdetails und Zahlungsstatus. Der Contract weist clientgelieferte Gruppen- oder Ticketcodes
  als unbekannte Felder zurück.
- Der Event Coordinator lässt Gruppen- und Ticketcodes im Worker erzeugen. Jeder Code besteht aus
  16 nicht missverständlichen Zeichen eines 32-Zeichen-Alphabets und besitzt damit 80 Bit
  Zufallsentropie; die Zufallsbytes stammen aus `crypto.getRandomValues`.
- Vor der Persistenz prüft der Worker die Hashes gemeinsam gegen Gruppen- und Ticketbestand. Eine
  Kollision oder ein innerhalb der Charge doppelter Kandidat führt zu einer vollständigen
  Neuziehung. Nach acht erfolglosen Versuchen bricht der Verkauf wirkungslos mit
  `PUBLIC_CODE_ALLOCATION_FAILED` ab.
- Die veranstaltungsbezogene Durable-Object-Serialisierung hält Kollisionsprüfung und anschließenden
  D1-Batch gegenüber anderen Verkäufen derselben Veranstaltung exklusiv.
- Der bestätigte Verkaufsbeleg enthält Gruppen- und Ticketcodes. Derselbe Beleg wird atomar im
  Idempotenzbeleg gespeichert; Replays lesen ihn vor jeder neuen Codevergabe und kennzeichnen ihn
  lediglich mit `duplicate: true`.
- Audit-Payload und Outbox enthalten weiterhin keine Klarcodes. D1 speichert Suchhashes sowie die
  bereits für autorisierte Nachdrucke erforderlichen geschützten Klarwerte.
- Ausfallnachträge über `STAGE_OUTAGE_RECOVERY` bleiben eine getrennte, autorisierte Ausnahme: Sie
  übernehmen bereits auf Papier entstandene beziehungsweise vorgedruckte Codes und sind kein
  regulärer Online-Verkaufspfad.

## Folgen und Wiederherstellung

Manipulierte Online-Clients können keine aufzählbaren Codes mehr wählen. Gruppen- und Ticketcode
sind voneinander sowie innerhalb der Ticketcharge verschieden. Bestehende Hashes, Klarwerte,
Nachdrucke und öffentliche URLs bleiben unverändert gültig; es ist keine Datenbankmigration nötig.

Persistierte ältere Idempotenzbelege ohne die neue Ticketcodeliste bleiben lesbar. Ein Rollback
erfolgt durch Bereitstellung des vorherigen Workers; Schema- oder Datenreparaturen sind nicht
erforderlich. Neue Clients sind mit dem vorherigen Worker nicht kompatibel, weil das neue
Verkaufskommando keine Codes mehr transportiert; Worker und PWA werden weiterhin gemeinsam
ausgerollt.
