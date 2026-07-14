# Skalierungs- und Performance-Nachweis V1

`npm run test:scale-performance` erzeugt ausschließlich lokal und synthetisch das vollständige
Mengengerüst aus Q-PER-020:

- 20 gekoppelte und gleichzeitig per WebSocket verbundene Geräte,
- 1.000 anonyme Tickets,
- 300 offene Umläufe,
- 60 Monate Historie und
- 6.000 append-only Historienereignisse.

Der Test startet danach den echten Worker mit lokaler D1-Datenbank. Er prüft die vollständige
Operationssicht, 20 parallele Geräteabrufe, eine paginierte fachliche Historienseite, einen
versionierten Standardverkauf sowie die dadurch ausgelöste persistierte Prognoseneuberechnung aller
offenen Umläufe. Autorisierung, Vertragsvalidierung und normale Worker-Routen werden nicht
umgangen.

Referenzlauf am 14. Juli 2026:

| Messpunkt | Ergebnis | Grenze |
| --- | ---: | ---: |
| Operationssicht | 49 ms | < 2.000 ms |
| 20 parallele Geräte, p95 | 679 ms | < 2.000 ms |
| Historie, Seite 200 von 1.000 | 41 ms | < 2.000 ms |
| serverseitiger Standardverkauf | 89 ms | < 2.000 ms |
| Prognoseaktualisierung für 300 Umläufe | 89 ms | < 2.000 ms |

Die Messwerte sind harte Abbruchkriterien des Skripts; eine Überschreitung beendet den Lauf
fehlerhaft. Q-PER-020 und die Worker-Seite von Q-PER-010 sind damit reproduzierbar nachgewiesen.

Nicht durch diesen lokalen Lauf ersetzt werden die Browsermessung der lokalen UI-Reaktion unter
300 ms, der zwölfstündige Langlauf, die Cloudflare-Verfügbarkeitsmessung oder die Generalprobe auf
Originalhardware. Diese Nachweise bleiben eigene Abnahmepunkte.
