# Freigegebenes Administrationskonzept V2

Freigegeben am 13. Juli 2026. Die beiden Bilddateien sind die visuelle Spezifikation:

- `admin-master-data-v2-approved.png`
- `admin-factory-reset-v2-approved.png`

## Stammdaten

- Kategorien erscheinen in der fachlichen Reihenfolge Gates, Ressourcengruppen, Flugzeuge,
  Zuordnungen, Pilotencodes und Produkte.
- Die mittlere Liste zeigt vorhandene Datensätze und einen eindeutigen Einstieg zum Anlegen.
- Anlegen und Bearbeiten öffnet einen rechten Editor; ohne Auswahl bleibt der Arbeitsbereich frei.
- Unberührte Felder zeigen keine roten Fehler. Erst ein Speicherversuch markiert fachlich fehlende
  Eingaben.
- Der abschließende Bestätigungsdialog verlangt nur die Administrator-PIN. Das System protokolliert
  normale Stammdatenänderungen mit dem einheitlichen Audit-Grund `Administrative Stammdatenpflege`;
  normale Einrichtungs- und Konfigurationsänderungen erhalten entsprechend `Administrative
  Konfigurationspflege`. Eine freie Begründung bleibt operativen oder folgenreichen Aktionen wie
  Pausen, Widerruf, Neustart und Werksreset vorbehalten. Diese Vereinfachung wurde am 13. Juli 2026
  nach der Browserabnahme freigegeben.
- Fehlende Abhängigkeiten bieten einen direkten Weg zum benötigten Stammdatentyp.

## Sicherung und Reset

- Ein neuer Betriebsstand mit übernommenen Stammdaten bleibt vom leeren neuen Veranstaltungstag
  getrennt.
- Der Werkszustand ist eine eigene, rot abgesetzte Gefahrenzone.
- Der Werkszustand verlangt Begründung, Administrator-PIN und das exakte Wort `WERKSZUSTAND`.
- Standardmäßig wird vor dem Löschen eine portable R2-Wiederherstellungssicherung erzeugt.
- Die zusätzliche Option zum Leeren von R2 ist ausdrücklich endgültig und schließt das Behalten der
  Wiederherstellungssicherung aus.
- Nach Erfolg werden lokale Geräteschlüssel, Offline-Snapshots und die Push-Subskription entfernt;
  anschließend öffnet die Anwendung `/setup`.

## Designsystem

- Hintergrund: echtes Weiß; Flächen nur mit kühlem Hellgrau absetzen.
- Text: tiefes Marineblau; normale Primäraktion in zurückhaltendem Luftfahrtblau.
- Rot nur für den endgültigen Werkszustand.
- 6–8 px Ecken, dünne Linien, nahezu keine Schatten; Tabellen und offene Rails statt Kartenraster.
- Formulare und Dialoge bleiben bei kleiner Breite einspaltig; die Kategorien werden horizontal
  scrollbar.
