# Prognose-Simulator – Freigegebene Verlaufs- und Nachauswertung

Stand: 23. Juli 2026
Status: Freigegeben am 23. Juli 2026

Diese freigegebene Erweiterung ergänzt das bestehende Simulator-Konzept um zwei nachgelagerte
Auswertungszustände:

- [Verlauf einer Fluggruppe](forecast-simulator-group-history-approved.png)
- [Verlauf eines Flugzeugs](forecast-simulator-aircraft-history-approved.png)

Die bestehenden Haupt- und Szenarioansichten bleiben unverändert. Die neue
`Verlaufsauswertung` öffnet als breiter Dialog über dem Simulator. Sie ist während des Laufs für
den bis zur virtuellen Zeit sichtbaren Stand und nach Simulationsende für den vollständigen Lauf
verfügbar.

## Automatischer Voraufruf

Der heutige Simulator kennt keinen getrennten automatischen Voraufruf. Er bindet bei einem
verfügbaren Flugzeug unmittelbar die nächste Gruppe und setzt `calledAt`. Künftig verwendet er
dieselben reinen Domain-Funktionen wie der Worker:

- `deriveAdaptivePrecallLeadMinutes` für den aus bisherigen Gate-Wartezeiten des aktuellen Laufs
  abgeleiteten Zielvorlauf;
- `selectAutomaticPrecalls` für Aktivierung, Betriebszustand, zusammenhängendes Queue-Präfix,
  Gruppengröße, verfügbare Kapazität und den vor dem Lauf gespeicherten Gate-Cooldown.

Der Standardlauf aktiviert den automatischen Voraufruf. Im Szenarioeditor ist nur diese fachliche
Aktivierung konfigurierbar; technische Einzelschwellen werden entsprechend ADR-0012 nicht als
reguläre Bedienparameter angeboten.

Ein erfolgreicher Voraufruf erzeugt:

- `SimulationRotation.precalledAt`;
- `precallTrigger: "AUTOMATIC_PRECALL"`;
- die Diagnosewerte Prognosequalität, prognostizierter Boardingzeitpunkt und adaptiver Vorlauf zum
  Auslösezeitpunkt;
- das chronologische Ledger-Ereignis `FLIGHT_GROUP_PRECALLED`.

`GO TO GATE` bindet weder Flugzeug noch Pilot. Die Flugzeugbindung entsteht weiterhin erst beim
simulierten bestätigten Boardingbeginn (`calledAt` / `ROTATION_CALLED`). Mehrere berechtigte Gruppen
dürfen im selben 30-Sekunden-Tick gemeinsam voraufgerufen werden. Liegen Voraufruf und Boarding
mangels sinnvoller Vorlaufzeit auf demselben Tick, werden beide getrennt und in fachlich richtiger
Reihenfolge festgehalten.

## Fluggruppenansicht

Die Registerkarte `Fluggruppen` zeigt für jede synthetische Gruppe:

- den realisierten Meilensteinverlauf `GO TO GATE`, Boarding, Off-Block, On-Block und
  abgeschlossen;
- beim Voraufruf ausdrücklich den Hinweis `systemseitig · noch ohne Flugzeugbindung`;
- sämtliche Prognosesnapshots des Laufs, nicht nur die für aggregierte 60-/30-/15-Minuten-Metriken
  ausgewählten Stichpunkte;
- je Snapshot Erfassungszeit, Umlaufstatus, Qualität, prognostizierte Zeiten für alle vier Phasen,
  Stichprobengröße, Lernwertalter, aktive Kapazität und gegebenenfalls Unterdrückungsgründe;
- eine Verlaufsgrafik mit allen prognostizierten Uhrzeiten, den realisierten Ist-Zeitpunkten und
  einer Markierung des automatischen Voraufrufs.

Die Tabelle bleibt die vollständige, exakte Datendarstellung. Die Grafik ist eine daraus abgeleitete
visuelle Hilfe und darf keine Snapshots verschweigen oder zeitlich glätten. Bei `UNCERTAIN` bleiben
Rohwerte sichtbar, werden aber weiterhin als nicht freigegeben gekennzeichnet.

## Flugzeugansicht

Die Registerkarte `Flugzeuge` zeigt für jedes synthetische Flugzeug:

- eine Tageszeitleiste aller tatsächlich zugewiesenen Umläufe mit Boarding, Flug und Turnaround;
- Tanken, geplante und ungeplante Pausen, technische Defekte, Tagesausfall und bestätigte
  Rückkehrereignisse;
- die realisierten Zeiten jeder zugewiesenen Gruppe;
- Betriebszeit, Sperrzeit, Anzahl abgeschlossener Umläufe und diagnostische Auslastung;
- einen direkten Wechsel in den vollständigen Prognoseverlauf der jeweiligen Fluggruppe.

Ein vor Boarding liegender Voraufruf darf nicht nachträglich als Flugzeugprognose erscheinen. Seine
Uhrzeit wird in der Umlauftabelle nur als gruppenbezogener Kontext mit dem Hinweis
`vor Bindung` angezeigt. Damit bleibt die fachliche Invariante der flexiblen Flugzeugzuordnung
erhalten.

## Bedienung und Zustand

- `Verlauf anzeigen` öffnet aus einer ausgewählten Gruppe direkt die Fluggruppenansicht.
- `Lauf auswerten` öffnet die Auswertung unabhängig von einer Vorauswahl.
- Ein Klick auf eine Flugzeugkennung wechselt in die Flugzeugansicht; `Gruppe öffnen` führt zurück
  zum Prognoseverlauf der Gruppe.
- Auswahl, Suche und Register werden als minimaler UI-Zustand geführt. Snapshot-Indizes,
  Flugzeughistorien und Kennzahlen werden per `useMemo` aus dem unveränderten Simulationsergebnis
  abgeleitet; es entsteht keine zweite fachliche Datenhaltung in React.
- Lange Snapshotlisten scrollen innerhalb des Dialogs. Der Dokumentkörper erhält keinen
  horizontalen Überlauf.

## Export und Kennzahlen

Die Verlaufserweiterung hob den JSON-Export zunächst auf `rundflug-forecast-simulation/v3` an.
Mit dem später freigegebenen Tuning-Labor gilt `rundflug-forecast-simulation/v4`. Er enthält die
Voraufruffelder und `FLIGHT_GROUP_PRECALLED`-Ereignisse. Die vorhandenen Rotationen,
Prognosesnapshots, Flugzeuge und Störungsereignisse bleiben die normalisierte Datengrundlage; Namen,
Telefonnummern, Ticketcodes, PINs und Secrets bleiben ausgeschlossen.

Ergänzende diagnostische Kennzahlen:

- Anteil der Gruppen mit automatischem Voraufruf;
- Median und P90 von `GO TO GATE → Boarding`;
- Anzahl gleichzeitiger Voraufruf-/Boarding-Ticks;
- Anzahl der Voraufrufe während echter Prognoseunsicherheit.

Diese Werte bewerten die organisatorische Wirkung des Voraufrufs. Sie besitzen keine
flugbetriebliche oder sicherheitsbezogene Freigabesemantik.
