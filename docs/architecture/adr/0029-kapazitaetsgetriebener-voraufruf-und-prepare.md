# ADR-0029: Kapazitätsgetriebener Voraufruf und öffentlicher PREPARE-Status

- Status: Teilweise ersetzt durch ADR-0032
- Datum: 2026-07-28
- Copy geändert: 2026-07-28 durch OQ-16
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-FLT-090, F-PRG-020, F-PRG-030, F-BEN-030, F-BEN-090,
  F-BEN-100, Q-UX-020 und Q-ZUV-020
- Teilweise ersetzt: Die Queue-Präfix- und Nicht-Überholen-Entscheidung wird durch
  [ADR-0032](0032-durchsatz-und-fairnessorientierte-dispatch-planung.md) ersetzt.

## Kontext

Der automatische Aufruf verwendete bisher zusätzlich zur Ressourcengruppen-Queue einen
veranstaltungsweiten Zwei-Minuten-Cooldown je Gate. Dadurch konnte ein Aufruf für „Rundflug
Oldtimer“ den kapazitätsmäßig unabhängigen Aufruf für „Rundflug“ am selben Gate blockieren. Die
Prognose koppelte außerdem je Ressourcengruppe erneut alle Piloten ein, berücksichtigte die
Sitzplatzzahl nicht auf der einzelnen Verfügbarkeitsbahn und konnte bei fehlender Bahn ein
unsicheres Null-Minuten-Fenster erzeugen.

Der vorhandene Push zur Vorbereitung war fachlich sinnvoll, wurde öffentlich aber weiterhin als
`WARTEN` dargestellt. Damit blieb für Gäste unsichtbar, ob ihr Aufruf tatsächlich bevorstand oder
ob Kapazität, Queue-Reihenfolge oder ein Betriebszustand ihn blockierte.

## Entscheidung

- Der gemeinsame Gate-Cooldown ist keine fachliche Sperre mehr. Jede Ressourcengruppe wählt ihr
  stabiles, ohne Überholen gebildetes Queue-Präfix anhand ihrer eigenen Prognosebahnen.
- Eine Prognosebahn koppelt genau ein Flugzeug und einen veranstaltungsweit nur einmal verwendeten
  anonymen Pilotencode. Bestätigte aktuelle Flugzeug-Pilot-Zuordnungen werden zuerst berücksichtigt.
- Jede Bahn trägt die tatsächliche Passagiersitzplatzkapazität. Eine Gruppe reserviert nur eine
  zeitlich passende Bahn mit ausreichender Größe.
- Pausen und operative Blockierungen ohne erwarteten Rückkehrzeitpunkt erzeugen keine zukünftige
  Bahn. Ein bekannter Rückkehrzeitpunkt wird als unsicheres Verfügbarkeitsintervall berücksichtigt,
  setzt die Ressource aber nicht automatisch auf verfügbar.
- Fehlt jede Bahn, lautet die Entscheidung `NO_FORECAST_CAPACITY`; sind nur zu kleine Flugzeuge
  projizierbar, lautet sie `NO_FITTING_AIRCRAFT`. In beiden Fällen werden weder ein künstliches
  Null-Minuten-Fenster noch PREPARE oder GO TO GATE veröffentlicht.
- Die Entscheidung wird nach relevanten Ereignissen und während eines aktiven Betriebs mindestens
  alle 30 Sekunden erneut berechnet. Der letzte Status, Grund, Prognosepunkt und adaptive Vorlauf
  werden an der Fluggruppe gespeichert und operativ angezeigt.
- `PREPARE` ist ein eigener öffentlicher Vorstatus zwischen `WARTEN` und `GO TO GATE`. Die deutsche
  Darstellung lautet `BEREITHALTEN` mit dem Text „Ihr Aufruf steht bevor. Bitte halten Sie sich in
  der Nähe des Gates bereit.“ Ticket und Gruppe verwenden dieselbe Aussage; der Push nennt
  zusätzlich das konkrete Gate. Erst `COME_TO_FLIGHT_LINE` fordert als `BITTE ZUM GATE` zum
  direkten Gang zum Gate auf, `BOARDING` bestätigt danach den begonnenen Einstieg.
- PREPARE bindet weder Flugzeug noch Pilot, startet kein Boarding und erzeugt keine
  flugbetriebliche Freigabe. GO TO GATE bleibt ein eigener, versionierter und auditierter
  automatischer Zustandswechsel.
- Das Legacy-Feld `precallGateCooldownMinutes` bleibt für Import, Export und ältere Clients
  syntaktisch kompatibel, wird aber weder fachlich ausgewertet noch regulär administriert.

## Abweichung von F-BEN-090

F-BEN-090 nennt für das Terminalprofil ausschließlich WAITING, GO TO GATE, BOARDING, DEPARTED und
DELAYED. Diese Entscheidung erweitert die öffentliche Menge bewusst um PREPARE. OQ-16 ändert den
anfangs ortsneutralen Hinweis zu einer Bitte, sich in der Nähe des Gates bereitzuhalten. Der direkte
Gang zum Gate und der Boardingbeginn bleiben davon getrennte Handlungsanweisungen. Die Erweiterung
ist vom Auftraggeber mit dem Umsetzungskonzept freigegeben und wird als kontrollierte
Anforderungskonkretisierung in Traceability und Open-Questions dokumentiert.

## Folgen

- Unabhängige Ressourcengruppen am selben Gate können gleichzeitig entsprechend ihrer tatsächlichen
  Flugzeug-, Sitzplatz- und Pilotenkapazität aufrufen.
- Die Queue bleibt stabil; eine nicht passende Vordergruppe wird nicht durch eine kleinere
  Folgegruppe überholt.
- Produktions-Worker und Simulator verwenden dieselbe reine Domainentscheidung.
- PREPARE, GO TO GATE und BOARDING besitzen getrennte Push-Typen und bleiben durch den eindeutigen
  Zustellbeleg je Ziel, Umlauf und Typ idempotent. GO TO GATE entsteht weiterhin automatisch;
  BOARDING erst nach menschlich bestätigtem `CALL_NEXT`.
- Migration `0052_precall_decisions.sql` ist additiv und benötigt vor Anwendung eine portable
  Sicherung oder D1-Time-Travel-Marke.
- Migration `0053_distinct_public_push_transitions.sql` erweitert den zulässigen Push-Typkatalog
  durch Tabellenneuaufbau. Bestehende Legacy-Belege bleiben unverändert; Sicherung und
  Wiederherstellung sind im Migrationsregister dokumentiert.
