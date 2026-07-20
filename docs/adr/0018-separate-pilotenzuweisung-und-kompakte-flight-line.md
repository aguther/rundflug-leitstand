# ADR-0018: Separate Pilotenzuweisung und kompakte Flight Line

- Status: Akzeptiert
- Datum: 2026-07-20
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V161-FL-010, V161-FL-020, V161-FL-030, V161-FL-040,
  F-BRD-010, F-BRD-020, F-FLT-030, F-FLT-040, F-HIS-010, D-050, Q-UX-010, Q-ZUV-040

## Kontext

Die bisherige Supervisor-Tabelle öffnet eine vollständige Belegungsfläche innerhalb einer
Flugzeugzeile. Dadurch sind weitere Flugzeuge je nach Bildschirmhöhe nicht erreichbar und Status
werden durch einen zu allgemeinen CSS-Selektor teilweise unlesbar. Die Pilotenauswahl ist außerdem
mit der Buchungsgruppenbelegung gekoppelt, obwohl Pilot und Flugzeug organisatorisch bereits vor dem
Boarding verbunden werden können.

## Entscheidung

- Der Supervisor verwendet eine kompakte Tabelle mit einem eigenen vertikalen und bei Bedarf
  horizontalen Scrollbereich. Flugzeugzeilen werden nicht aufgeklappt.
- Buchungsgruppenbelegung und Pilotzuweisung verwenden getrennte, zentrierte Dialoge. Gruppen bleiben
  vollständig; Anwesenheit und konkrete Flugzeugkapazität werden weiterhin hart geprüft.
- `ASSIGN_AIRCRAFT_PILOT` verwaltet eine exklusive anonyme Pilotvormerkung je Flugzeug. Flugleitung
  und Administration dürfen sie ohne aktiven Umlauf oder während `CALLED` ändern. Ab Offblock bis
  zum Umlaufabschluss bleibt die Zuordnung unverändert.
- Eine Vormerkung an einem anderen konfliktfreien Flugzeug wird ausschließlich nach separater
  Bestätigung atomar umgehängt. Ein aktiver Umlauf des anderen Flugzeugs wird nie automatisch
  verändert.
- `CALL_NEXT` behält seinen Vertrag einschließlich `pilotId`, akzeptiert aber nur den bereits am
  gewählten Flugzeug vorgemerkten Code. Die Belegung selbst ändert keine Pilotvormerkung mehr.
- Der Zeitpunkt des letzten echten Flugzeug-Zustandswechsels wird separat von `updated_at`
  persistiert. Stammdatenpflege darf die sichtbare Dauer im Zustand nicht zurücksetzen.

## Folgen

ADR-0012 bleibt für Flugzeugzentrierung und Voraufruf wirksam; die gemeinsame Pilotenauswahl beim
Boarding wird durch diese Entscheidung ersetzt. Pilotänderungen erzeugen genau ein append-only
`AIRCRAFT_PILOT_CHANGED`-Ereignis mit Idempotenzbeleg und Outbox in derselben D1-Grenze. Technische
Statuswerte werden über eine zentrale deutsche Domänenabbildung ausgegeben.
