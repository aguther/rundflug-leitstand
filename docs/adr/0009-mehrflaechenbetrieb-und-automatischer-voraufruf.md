# ADR-0009: Mehrflächenbetrieb, automatischer Voraufruf und öffentliche Anzeigen

- Status: Akzeptiert
- Datum: 2026-07-16
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-FLT-030, F-FLT-090, F-MON-010, F-MON-060, F-BEN-030,
  F-BEN-090, F-INT-070, Q-UX-020, Q-UX-070 und Q-ZUV-020

## Kontext

Eine einzige Flight-Line-Ansicht kann weder die dichte Disposition am Desktop noch die schnelle
Zustandserfassung durch mehrere Helfer auf Mobilgeräten gut abdecken. Gleichzeitig soll die Flight
Line nicht fortlaufend selbst entscheiden müssen, welche wartende Gruppe sich bereits zum Gate
begeben soll. Öffentliche Standardmonitore und eine klassische Terminaltafel benötigen denselben
fachlichen Stand, aber unterschiedliche Typografie und Sprache.

## Entscheidung

- Flight Line Supervisor ist die dichte Desktop-Gesamtsicht für Flotte, Queue, Prognose und
  Ausnahmen.
- Flight Line Assist ist eine vereinfachte Tablet-/Telefonansicht. Anonyme, kurzlebige
  Gerätereservierungen verhindern, dass zwei Helfer unbemerkt dasselbe Flugzeug bearbeiten.
- Das System löst den Voraufruf `GO TO GATE` automatisch anhand von Queue, Prognosequalität,
  Vorlauf und maximal akzeptierter Gate-Wartezeit aus.
- Der Voraufruf bindet kein Flugzeug. `NEXT`, Flugzeugbindung und Boardingbeginn bleiben menschlich
  bestätigt.
- Flugzeug- und Pilotencode-Pausen dürfen eine geschätzte Dauer besitzen. Diese beeinflusst die
  Prognose, setzt die Ressource nach Ablauf aber nicht automatisch auf verfügbar.
- Das Standard-FIDS verwendet deutsche Begriffe. Das Terminal-FIDS verwendet ausschließlich
  englische beschreibende Begriffe.
- Nach `IM FLUG` bleibt eine Zeile kurz als `DEPARTED` beziehungsweise „Abgeflogen“ sichtbar und
  verschwindet danach nur aus der öffentlichen Liste.
- Bei Server- oder D1-Problemen bleiben letzte bestätigte Daten sichtbar. Schreibaktionen benötigen
  weiterhin einen bestätigten, aktuellen Stand.

## Folgen

Automatischer Voraufruf und operative Bestätigung werden getrennte Ereignisse. Für Assist-Geräte ist
eine auslaufende Koordinationsreservierung erforderlich, die keine fachliche Flugzeugzuordnung ist.
Pausen benötigen einen optionalen erwarteten Rückkehrzeitpunkt. Display-Konfigurationen benötigen
Profil und Nachlaufzeit. Alle neuen Schreibpfade bleiben idempotent, versionsgeprüft und auditiert.

Das freigegebene Bedienkonzept steht in
`docs/ui/operations-v2-multi-surface-concept.md`.
