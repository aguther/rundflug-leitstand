# ADR-0019: Getrennte Assist-Auswahl und -Arbeitsansicht

- Status: Akzeptiert
- Datum: 2026-07-21
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V17-UI-030, V17-FL-010, V17-FL-020, V161-FL-030, V161-FL-040,
  F-BRD-010, F-BRD-020, F-FLT-030, F-FLT-040, F-HIS-010, Q-UX-010

## Kontext

Die bisherige Assist-Ansicht zeigt Flugzeugliste und Bearbeitungsbereich gleichzeitig. Auf kleinen
Bildschirmen liegt die Arbeitsfläche dadurch weit unterhalb der übernommenen Flugzeugkarte; auf dem
Desktop entsteht ein abweichender Zweispaltenablauf. Außerdem bildet die Assist-Statusleiste den
Supervisor-Zustand und dessen tatsächliche Zeitpunkte nur unvollständig ab. Das Ansichtsmenü kann auf
schmalen Viewports rechts über den Bildschirm hinausragen.

## Entscheidung

- Assist besitzt auf allen Geräten zwei exklusive Modi: ohne eigenen Claim die scrollbare
  Flugzeugauswahl, mit eigenem Claim die vollständige Arbeitsansicht des übernommenen Flugzeugs.
- Der Server-Claim ist die wiederherstellbare Quelle des aktiven Modus. Status- und
  Realtime-Aktualisierungen beenden den Claim nicht. Regulär führt ausschließlich die explizite
  Aktion „Flugzeug freigeben“ zurück zur Auswahl; ein externer Verlust oder Ablauf wird sichtbar
  erklärt und erzwingt technisch dieselbe Rückkehr.
- Die Arbeitsansicht verwendet die gemeinsamen Supervisor-Bausteine für deutschen Status,
  semantische Farbe, Zustandszeit, Pilotencode, aktuellen Umlauf, Ist-Zeitlinie und Historie.
- `FLIGHT_LINE` wird für `SET_AIRCRAFT_OPERATIONAL_STATE` autorisiert. Zustandsautomat,
  erwartete Version, Idempotenz, Audit und Outbox bleiben unverändert. Damit ist insbesondere
  `INACTIVE` nach `AVAILABLE` operativ möglich.
- `ASSIGN_AIRCRAFT_PILOT` bleibt gemäß ADR-0018 ausschließlich `FLIGHT_DIRECTOR` und `ADMIN`
  vorbehalten. Berechtigte Assist-Nutzer verwenden denselben konfliktgeprüften Dialog wie der
  Supervisor.
- Das Ansichtsmenü wird unterhalb 560 Pixel viewportbezogen eingerückt; jede Zeile reserviert
  getrennten Platz für Symbol, umbrechbaren Text und Status beziehungsweise Haken.

## Folgen

Die frühere Tablet-Zweispaltenfestlegung für Assist ist abgelöst; Flugzeugauswahl und -bearbeitung
bleiben geräteübergreifend konsistent. Es entstehen keine neue API, Migration oder D1-Spalte. Die
vollständige Gruppenauswahl einschließlich Kapazitäts- und Gruppenschutz sowie das mobile
Drei-Punkte-Menü bleiben bestehen.
