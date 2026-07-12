# Verifikation öffentliche Monitore V1

Der automatisierte Nachweis wird mit `npm run test:public-monitors` ausgeführt. Er prüft zwei kommende
Gruppen unterschiedlicher Produkte, sichere öffentliche Ticketkennungen, Boardingaufruf, Flugzeug- und
Flottenstatus sowie den Ausschluss privater Ticketcodes und Pilotendaten. Außerdem werden eine
WebSocket-Aktualisierung unter zwei Sekunden, die automatische Neuverbindung und das 15-Sekunden-
Polling als Rückfallebene verifiziert. Statusfarben werden stets durch ausgeschriebenen Text ergänzt.

Zusätzlich prüft der Lauf den Ticketstatus ohne Anmeldung, die Vorbereitung aus Prognose und
konfigurierter Vorlaufgrenze, den verbindlichen Aufruf, Boarding nach Check-in sowie die freiwillige
Push-Registrierung. Ohne ausdrückliche Einwilligung wird sie abgelehnt. Einwilligungszeitpunkt und
Löschzeitpunkt werden zurückgegeben, der Vorbereitungshinweis wird trotz Wiederholung nur einmal
vorgemerkt und ein Widerruf löscht das Ziel unmittelbar.

Der Referenzlauf lieferte die Ticketkennungen `PAN20-101/1` und `PAN20-101/2`, eine Neuverbindung nach
14 Millisekunden und die abschließende Veranstaltungsversion 7.

Die Browserprüfung erfolgte im Kioskmodus auf Desktopbreite und mit 430 × 900 Pixeln. Produkt, Gruppe,
Tickets, Status, Gate, Flugzeug, Zeitfenster und Flottenzeile blieben in beiden Ansichten sichtbar. Der
Zustandswechsel `IM FLUG` nach `GELANDET` erschien ohne Neuladen innerhalb von zwei Sekunden; die
Browserkonsole blieb ohne Fehler und Warnungen.

Die Ticketstatusseite wurde zusätzlich auf Desktop und 430 × 900 Pixeln geprüft. Ein bereits
geöffnetes Ticket wechselte nach dem operativen Aufruf innerhalb von 188 Millisekunden ohne Neuladen
auf „Bitte zur Flight Line“. Produkt, Gate, handlungsorientierter Status, Web-Push und
Datenschutzhinweis blieben auf beiden Breiten sichtbar; die Browserkonsole blieb sauber.
