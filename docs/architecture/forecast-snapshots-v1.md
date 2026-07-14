# Prognose-Snapshots V1

## Erfassungszeitpunkt

Nach jedem erfolgreich persistierten operativen Kommando stößt das Durable Object die erneute
Prognoseberechnung an. Für jeden noch offenen Umlauf wird dabei ein Snapshot mit der bestätigten
Veranstaltungsversion, Erfassungszeitpunkt, Qualitätsstufe, Minutenintervall und den prognostizierten
Zeitpunkten für Boarding, Start, Landung und Abschluss geschrieben. Zusätzlich hält der Snapshot den
auslösenden fachlichen Ereignistyp, Historienbezug, Stichprobengröße und Datenalter sowie aktive
Kapazität und verwendete Referenzdauer fest. Damit ist nicht nur das Ergebnis, sondern auch seine
Datengrundlage nachvollziehbar. Fehlgeschlagene oder abgelehnte Kommandos erzeugen keinen Snapshot.

## Unveränderlichkeit und Auswertung

`forecast_snapshots` ist nur anfügend. D1-Trigger verbieten Update und Delete. Die Kombination aus
Veranstaltungsversion und Erfassungszeitpunkt erlaubt nach dem Veranstaltungstag den Vergleich der
Prognoseentwicklung mit den getrennt gespeicherten Ist-Ereignissen. Die Tabelle ist Bestandteil der
portablen R2-Sicherung.

## Wiederherstellung

Bei einer Wiederherstellung wird die Tabelle zusammen mit den operativen Daten aus der portablen
Sicherung importiert. Fehlen historische Snapshots, bleibt der aktuelle operative Zustand nutzbar;
lediglich die nachträgliche Prognosegüte für den fehlenden Zeitraum kann nicht ausgewertet werden.
Neue Snapshots werden nach dem nächsten bestätigten Kommando wieder regulär angefügt.
