# Verifikation öffentliche Monitore V1

Der automatisierte Nachweis wird mit `npm run test:public-monitors` ausgeführt. Er prüft zwei kommende
Gruppen unterschiedlicher Produkte, sichere öffentliche Ticketkennungen, Boardingaufruf, Flugzeug- und
Flottenstatus sowie den Ausschluss privater Ticketcodes und Pilotendaten. Außerdem werden eine
WebSocket-Aktualisierung unter zwei Sekunden, die automatische Neuverbindung und das 15-Sekunden-
Polling als Rückfallebene verifiziert. Statusfarben werden stets durch ausgeschriebenen Text ergänzt.
Die öffentlichen Verträge lehnen zusätzliche exakte Plan- oder Prognosezeitstempel ab. Der
Integrationslauf prüft Ticketstatus und FIDS rekursiv auf solche Felder und validiert stattdessen
nichtnegative Zeitfenster mit konsistenter Unter- und Obergrenze. Damit erscheint gegenüber Gästen
keine einzelne Uhrzeit als feste Zusage.

Zusätzlich prüft der Lauf den Ticketstatus ohne Anmeldung, den automatischen Voraufruf aus
Queueposition, Prognosequalität und konfigurierter Gate-Wartezeit, den getrennten verbindlichen
`NEXT`-Aufruf, Boarding nach Check-in sowie die freiwillige Push-Registrierung. Ohne ausdrückliche
Einwilligung wird sie abgelehnt. Einwilligungszeitpunkt und Löschzeitpunkt werden zurückgegeben, der
`GO_TO_GATE`-Hinweis wird trotz Wiederholung nur einmal vorgemerkt und ein Widerruf löscht das Ziel
unmittelbar.

Standard-FIDS und Terminal-FIDS werden getrennt geprüft. Das Standardprofil verwendet deutsche
Handlungsbegriffe. Das Terminalprofil enthält in allen sichtbaren Zuständen ausschließlich englische
Begriffe wie `GO TO GATE`, `BOARDING`, `DELAYED` und `DEPARTED`. Abgeschlossene Flüge bleiben für die
konfigurierte Nachlaufzeit sichtbar und verschwinden danach nur aus der Anzeige; Historie und Audit
bleiben unverändert. Der Standardwert beträgt fünf Minuten, zulässig sind eine bis fünfzehn Minuten.

Der Referenzlauf liefert öffentliche Ticketkennungen im Format `G-PAN20-0101/1` und
`G-PAN20-0101/2`. Die zugehörige operative Kennung verwendet das Format `F-PA-…`; beide vollständigen
Kennungen führen in der internen Ticketsuche zur selben Buchungsgruppe. Neuverbindung und
abschließende Veranstaltungsversion werden weiterhin im automatisierten Lauf erfasst.

Die Browserprüfung erfolgte im Kioskmodus auf Desktopbreite und mit 430 × 900 Pixeln. Produkt, Gruppe,
Tickets, Status, Gate, Flugzeug, Zeitfenster und Flottenzeile blieben in beiden Ansichten sichtbar. Der
Zustandswechsel `IM FLUG` nach `GELANDET` erschien ohne Neuladen innerhalb von zwei Sekunden; die
Browserkonsole blieb ohne Fehler und Warnungen.

Die Ticketstatusseite wurde zusätzlich auf Desktop und 430 × 900 Pixeln geprüft. Ein bereits
geöffnetes Ticket wechselte nach dem operativen Aufruf innerhalb von 188 Millisekunden ohne Neuladen
auf „Bitte zur Flight Line“. Produkt, Gate, handlungsorientierter Status, Web-Push und
Datenschutzhinweis blieben auf beiden Breiten sichtbar; die Browserkonsole blieb sauber.
