# Verifikation Kommando- und Echtzeitpipeline V1

`npm run test:vertical-slice` prüft den vollständigen synthetischen Ablauf mit gleichzeitig
verbundener Kasse und Flight Line. Der Nachweis umfasst:

- identische Versionssignale an zwei verbundene Geräte in weniger als zwei Sekunden,
- automatische WebSocket-Wiederverbindung,
- Ablehnung eines ungekoppelten Geräts und einer falschen Geräterolle,
- Idempotenz bei Wiederholung und Konflikt bei veralteter erwarteter Version,
- Gerätezuordnung im append-only Ereignisverlauf und nachvollziehbare Aufrufkorrektur,
- konsistente Zustände von Umlauf, Tickets und Flugzeug bis zum Abschluss.

Im Referenzlauf lag das langsamste parallele Versionssignal bei 27 Millisekunden und die
Wiederverbindung bei 7 Millisekunden. Die Browserprüfung verwendete gleichzeitig Kasse und FIDS. Ein
zweiter Verkauf erschien nach 408 Millisekunden ohne Neuladen als neue Fluggruppe; beide
Browserkonsolen blieben ohne Fehler und Warnungen.
