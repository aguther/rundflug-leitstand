# Verifikation Stammdaten und Ressourcengruppen V1

`npm run test:master-data` erzeugt ausschließlich synthetisch ein Gate, eine gemeinsame
Ressourcengruppe, zwei kompatible Flugzeuge und zwei Produkte unterschiedlicher Dauer. Der Lauf
weist nach:

- jedes Produkt besitzt genau einen Ressourcengruppen- und Gate-Bezug,
- beide Produkte zeigen dieselbe gemeinsame Queue-Nachfrage,
- zwei Flugzeuge können derselben Gruppe zugeordnet werden,
- Typkompatibilität, Sitzplätze, Referenzkapazität und Planumlaufzeit sind konfiguriert,
- ein veralteter paralleler Stammdatenbefehl wird abgelehnt,
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
