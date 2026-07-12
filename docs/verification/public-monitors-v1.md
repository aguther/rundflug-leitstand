# Verifikation öffentliche Monitore V1

Der automatisierte Nachweis wird mit `npm run test:public-monitors` ausgeführt. Er prüft zwei kommende
Gruppen unterschiedlicher Produkte, sichere öffentliche Ticketkennungen, Boardingaufruf, Flugzeug- und
Flottenstatus sowie den Ausschluss privater Ticketcodes und Pilotendaten. Außerdem werden eine
WebSocket-Aktualisierung unter zwei Sekunden, die automatische Neuverbindung und das 15-Sekunden-
Polling als Rückfallebene verifiziert. Statusfarben werden stets durch ausgeschriebenen Text ergänzt.

Der Referenzlauf lieferte die Ticketkennungen `PAN20-101/1` und `PAN20-101/2`, eine Neuverbindung nach
10 Millisekunden und die abschließende Veranstaltungsversion 6.

Die Browserprüfung erfolgte im Kioskmodus auf Desktopbreite und mit 430 × 900 Pixeln. Produkt, Gruppe,
Tickets, Status, Gate, Flugzeug, Zeitfenster und Flottenzeile blieben in beiden Ansichten sichtbar. Der
Zustandswechsel `IM FLUG` nach `GELANDET` erschien ohne Neuladen innerhalb von zwei Sekunden; die
Browserkonsole blieb ohne Fehler und Warnungen.
