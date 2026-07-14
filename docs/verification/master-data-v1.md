# Verifikation Stammdaten und Ressourcengruppen V1

`npm run test:master-data` erzeugt ausschließlich synthetisch ein Gate, eine gemeinsame
Ressourcengruppe, zwei kompatible Flugzeuge und zwei Produkte unterschiedlicher Dauer. Der Lauf
weist nach:

- jedes Produkt besitzt genau einen Ressourcengruppen- und Gate-Bezug,
- Produkte lassen sich über den realen Worker-/D1-Pfad anlegen und ändern; der bestätigte
  Lesestand enthält Name und Cent-genau gespeicherten Preis,
- Produktanlage und -änderung erzeugen jeweils einen append-only Audit-Eintrag,
- unbekannte Ressourcengruppen/Gates, doppelte Produktkürzel und widersprüchliche
  Gewichtskonfigurationen werden ohne Versionsänderung abgelehnt,
- beide Produkte zeigen dieselbe gemeinsame Queue-Nachfrage,
- zwei Flugzeuge können derselben Gruppe zugeordnet werden,
- Typkompatibilität, Sitzplätze, Referenzkapazität und Planumlaufzeit sind konfiguriert,
- ein veralteter paralleler Stammdatenbefehl wird abgelehnt,
- eine endgültige Löschung funktioniert nur in der Vorbereitung, mit gültiger Administrator-PIN
  und ohne fachliche Abhängigkeiten,
- abhängige Stammdaten sowie Löschversuche nach der Betriebsfreigabe werden abgelehnt,
- erfolgreiche Löschungen erzeugen einen append-only Audit-Eintrag,
- Zuordnungs- und Statusänderungen erscheinen mit Gerät und Begründung im Auditverlauf,
- eine Gruppenpause blockiert Verkauf und Aufruf, macht die Prognose unsicher und erscheint auf
  Ticketstatus und FIDS ohne irreführenden Countdown,
- die Reaktivierung räumt die operative Blockierung nachvollziehbar auf.

Der Referenzlauf vom 14. Juli 2026 endete konsistent mit Veranstaltungsversion 18. Die
Kassenoberfläche zeigt je
Produkt neben der produktspezifischen Nachfrage ausdrücklich die Ticketzahl der gemeinsamen Queue.

Eine frühere Browserprüfung wies die gemeinsame Queue und Ressourcenpause mit gekoppelter
synthetischer Kasse sowie FIDS auf Desktop und 430 × 900 Pixeln nach. Sie ist kein aktueller
Abnahmenachweis für den noch zu überarbeitenden Produkteditor.

## Administration und Ersteinrichtung

Die Administrationsoberfläche wurde gegen das freigegebene Konzept
`docs/ui/admin-ux-v1-approved.png` geprüft. Sie gliedert die Aufgaben in Übersicht, Einrichtung,
Stammdaten, Betrieb sowie Sicherung und Reset. Der Einrichtungsfortschritt weist Parameter, Gates,
Ressourcengruppen, Flugzeuge, Zuordnungen, anonyme Pilotencodes, Produkte und Betriebsfreigabe als
acht voneinander abhängige Schritte aus.

Die frühere Prüfung auf Desktop und bei 430 × 900 Pixeln wies für die damalige Fassung nach:

- Kategorien und Einrichtungsfortschritt bleiben auf kleinen Bildschirmen intern scrollbar, ohne die
  gesamte Seite horizontal zu verschieben,
- vorhandene Gates, Ressourcengruppen, Flugzeuge, Pilotencodes und Produkte werden in Tabellen
  sichtbar und können zur Bearbeitung ausgewählt werden,
- Abhängigkeiten und fehlende Pflichtangaben werden direkt am betroffenen Arbeitsbereich erklärt,
- die damalige zentrale Bestätigung wurde verständlich benannt,
- Betriebssteuerung sowie Sicherung und Reset sind von der Stammdatenpflege getrennt.

Diese frühere Abnahme ist durch die inzwischen gemeldeten Kontrast-, Layout- und Produkteditor-
Probleme überholt. Die neue visuelle Abnahme erfolgt erst nach Umsetzung und Freigabe von
`docs/ui/product-master-data-v1.md` in Light/Dark sowie bei 430, 768 und 1440 Pixel Breite. Bis dahin
belegt dieses Dokument nur die Backend-/D1-Funktionalität, nicht die aktuelle Produkt-UX.
