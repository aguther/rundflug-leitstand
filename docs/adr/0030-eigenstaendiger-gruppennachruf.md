# ADR-0030: Eigenständiger aktiver Gruppennachruf

## Status

Angenommen – Release 1.11.0

## Kontext

Das bisherige Kommando `RECALL_TICKET_GROUP` setzte eine als fehlend markierte Gruppe wieder in die
Queue. Ein öffentlicher Nachruf hat eine andere Bedeutung: Er ist zeitlich begrenzt, muss erneut
Push auslösen können und darf Queue, Anwesenheit, Belegung oder den normalen FIDS-Status nicht
verändern.

## Entscheidung

- Nachrufe werden in `ticket_group_recalls` mit UUID, gruppenbezogener Sequenz, Start, Ablauf und
  optionalem Ende persistiert. Ein partieller Unique-Index erlaubt höchstens einen offenen Vorgang
  je Buchungsgruppe.
- `START_TICKET_GROUP_RECALL` und `CLEAR_TICKET_GROUP_RECALL` laufen über den
  veranstaltungsbezogenen Event Coordinator. Erwartete Version, Idempotenz, Audit und Outbox gelten
  unverändert.
- Derselbe Durable-Object-Alarm bedient Prognosetakt und Nachrufablauf. Es wird kein zweiter
  Alarmmechanismus eingeführt.
- Push-Zustellungen referenzieren die Nachruf-ID. Ziele werden ausschließlich über die exakte
  `ticket_group_id` ausgewählt.
- `RESTORE_TICKET_GROUP_TO_QUEUE` ist der fachlich richtige Name der bisherigen Queueaktion.
  `RECALL_TICKET_GROUP` bleibt in 1.11.0 nur als kontrollierter Vertragsalias erhalten.
- Öffentliche Texte sind feste, aus Gruppenkennung und Gate abgeleitete Vorlagen. Es werden keine
  personenbezogenen Daten gespeichert.
- Flight Line und Flight Director starten einen zulässigen Nachruf ohne Bestätigungsdialog direkt
  über einen festen Glocken-Button. Im aktiven Zustand bleibt derselbe Aktionsslot als
  hervorgehobener Umschalter erhalten; sein zugänglicher Tooltip nennt Startzeit und Sequenz, und
  erneutes Betätigen beendet exakt die aktuell projizierte Nachruf-ID.

## Folgen

Ein späterer Nachruf besitzt eine neue ID und Sequenz und erzeugt deshalb erneut Push. FIDS,
Ticketstatus und Gruppenstatus können denselben Vorgang projizieren, ohne den normalen
Umlaufzustand zu überschreiben. Die Direktbedienung benötigt weder frei editierbare Texte noch
optimistischen lokalen Nachrufstatus. Migration 0055 benötigt für eine Rückkehr den
D1-Time-Travel-Zeitpunkt vor der Migration oder ein geprüftes vollständiges Backup.
