# Verifikation Stammdaten und Ressourcengruppen V1

`npm run test:master-data` erzeugt ausschließlich synthetisch ein Gate, eine gemeinsame
Ressourcengruppe, zwei kompatible Flugzeuge und zwei Produkte unterschiedlicher Dauer. Der Lauf
weist nach:

- jedes Produkt besitzt genau einen Ressourcengruppen- und Gate-Bezug,
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

Der Referenzlauf endete konsistent mit Veranstaltungsversion 14. Die Kassenoberfläche zeigt je
Produkt neben der produktspezifischen Nachfrage ausdrücklich die Ticketzahl der gemeinsamen Queue.

Die Browserprüfung erfolgte mit gekoppelter synthetischer Kasse sowie FIDS auf Desktop und 430 × 900
Pixeln. Während der Gruppenpause zeigte die Kasse beide betroffenen Produkte als gesperrt und jeweils
zwei Tickets in der gemeinsamen Queue. Das FIDS zeigte ausgeschrieben „Organisatorischer Betrieb
pausiert“, Gate, Flottenzeile und `0–0 Min.` ohne abgeschnittene Pflichtangaben. Alle geprüften
Browserkonsolen blieben ohne Fehler und Warnungen.

## Administration und Ersteinrichtung

Die Administrationsoberfläche wurde gegen das freigegebene Konzept
`docs/ui/admin-ux-v1-approved.png` geprüft. Sie gliedert die Aufgaben in Übersicht, Einrichtung,
Stammdaten, Betrieb sowie Sicherung und Reset. Der Einrichtungsfortschritt weist Parameter, Gates,
Ressourcengruppen, Flugzeuge, Zuordnungen, anonyme Pilotencodes, Produkte und Betriebsfreigabe als
acht voneinander abhängige Schritte aus.

Die Prüfung auf Desktop und bei 430 × 900 Pixeln wies nach:

- Kategorien und Einrichtungsfortschritt bleiben auf kleinen Bildschirmen intern scrollbar, ohne die
  gesamte Seite horizontal zu verschieben,
- vorhandene Gates, Ressourcengruppen, Flugzeuge, Pilotencodes und Produkte werden in Tabellen
  sichtbar und können zur Bearbeitung ausgewählt werden,
- Abhängigkeiten und fehlende Pflichtangaben werden direkt am betroffenen Arbeitsbereich erklärt,
- Begründung und Administrator-PIN gelten zentral für die nächste auditierte Speicherung,
- Betriebssteuerung sowie Sicherung und Reset sind von der Stammdatenpflege getrennt.

Nach dem Cloudflare-Deployment `31a950b7-b6d0-4a0e-a00e-42cfac1fc9c7` wurde die angemeldete
Administration zusätzlich live geprüft. Die Betriebsdaten wurden ohne `403` oder `502` geladen, das
vorhandene Gate „Eingang Halle“ erschien in der Gate-Tabelle und ließ sich zum Bearbeiten öffnen. Nach
Eingabe einer Begründung benannte die Oberfläche die noch fehlende Administrator-PIN ausdrücklich,
anstatt die Ursache nur durch einen deaktivierten Button anzudeuten. Es wurden dabei keine
Betriebsdaten verändert. Die Browserkonsole blieb ohne Fehler und Warnungen.
