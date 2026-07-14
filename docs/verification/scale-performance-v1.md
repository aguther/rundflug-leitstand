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

## Lokale Browserreaktion

Die sichtbare Reaktion des Mengenschritts in der Kasse wurde am 14. Juli 2026 in Microsoft Edge über
das Chrome DevTools Protocol gemessen. Jede Probe beginnt mit dem programmatischen Klick, wartet auf
die React-DOM-Änderung und anschließend auf den nächsten Animationsframe. Dadurch wird nicht nur die
Event-Handler-Laufzeit, sondern die nächste darstellbare Reaktion erfasst.

| Viewport | Proben | Median | p95 | Maximum | Grenze |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desktop 1440 × 1000 | 100 | 16,7 ms | 18,1 ms | 18,5 ms | < 300 ms |
| Mobil 430 × 900 | 100 | 16,5 ms | 18,0 ms | 18,6 ms | < 300 ms |

Auf Mobil blieb die Seitenbreite bei exakt 430 Pixeln. Zusammen mit dem serverseitigen
Standardverkauf von 89 ms sind damit beide Grenzwerte aus Q-PER-010 nachgewiesen.

Nicht durch diese lokalen Läufe ersetzt werden der zwölfstündige Langlauf, die
Cloudflare-Verfügbarkeitsmessung oder die Generalprobe auf Originalhardware. Diese Nachweise bleiben
eigene Abnahmepunkte.
