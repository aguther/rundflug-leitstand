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

## Nachmessung der entkoppelten Aktionspfade

Am 24. Juli 2026 wurde derselbe lokale Worker-/D1-Skalierungslauf vor und nach ADR-0025 ausgeführt.
Die absoluten Werte hängen von der lokalen Maschine ab; aussagekräftig sind daher insbesondere der
gleiche Datensatz und derselbe Testablauf.

| Messpunkt | Vorher | Nachher | Grenze |
| --- | ---: | ---: | ---: |
| Operationssicht | 116 ms | 97 ms | < 2.000 ms |
| 20 parallele Geräte, p95 | 1.180 ms | 1.061 ms | < 2.000 ms |
| serverseitige Verkaufsbestätigung | 119 ms | 36 ms | < 2.000 ms |
| persistierte Forecast-Aktualisierung für 300 Umläufe | 119 ms | 289 ms | < 2.000 ms |

Die Forecast-Zeit enthält nun absichtlich ein 150-ms-Entprellfenster. Sie liegt nicht mehr im
Bestätigungspfad des Verkaufs und bleibt einschließlich Entprellung deutlich unter Q-PER-030.
Der Test verlangt zusätzlich `Server-Timing` für Operationsprojektion sowie getrennte
Kommando-Warte- und Ausführungszeit.

`npm run test:fleet-operations` prüft ergänzend den Parallelitätsvertrag gegen den echten Worker und
lokale D1: Zwei Flugzeugkommandos mit derselben beobachteten Veranstaltungsversion werden für
verschiedene Flugzeuge beide geordnet akzeptiert. Ein anschließender Schreibversuch mit veralteter
Version desselben Flugzeugs wird mit HTTP 409 abgelehnt. Damit werden F-INT-070 und Q-ZUV-040
gemeinsam nachgewiesen.

Die Browser-Abnahme gegen den echten lokalen Worker und D1 bestätigte am selben Tag die sichtbaren
Endzustände: Verkauf einschließlich aktualisierter Liste und vorbereitetem Gruppen-QR nach rund
312 ms, Flugzeugstatus `REFUELING` nach rund 295 ms. Beide Zeiten enthalten Serverrunde und
Browser-Automation und sind daher nicht mit der oben separat gemessenen lokalen
Eingabereaktionsgrenze gleichzusetzen. In Kasse und Flight Line traten keine Browserfehler auf.

Nicht durch diese lokalen Läufe ersetzt werden der zwölfstündige Langlauf, die
Cloudflare-Verfügbarkeitsmessung oder die Generalprobe auf Originalhardware. Diese Nachweise bleiben
eigene Abnahmepunkte.
