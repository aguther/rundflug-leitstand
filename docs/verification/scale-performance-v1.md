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

Im regulären `npm run check` ist dieser Lauf ein **lokales Skalierungs- und Regressionsgate**. Die
gemessenen Zeiten werden vollständig ausgegeben, blockieren CI aber erst bei der bewusst großzügigen
lokalen Schutzgrenze von standardmäßig 10.000 ms. Damit erkennt CI Hänger, Serialisierungsprobleme
und grobe Regressionen, ohne die variable Leistung eines GitHub-Runners mit der Cloudflare-Laufzeit
gleichzusetzen. Die Schutzgrenze kann für Diagnosezwecke mit
`SCALE_CI_GUARDRAIL_MILLISECONDS` zwischen 2.000 und 60.000 ms gesetzt werden.

Referenzlauf am 14. Juli 2026:

| Messpunkt | Ergebnis | Grenze |
| --- | ---: | ---: |
| Operationssicht | 49 ms | < 2.000 ms |
| 20 parallele Geräte, p95 | 679 ms | < 2.000 ms |
| Historie, Seite 200 von 1.000 | 41 ms | < 2.000 ms |
| serverseitiger Standardverkauf | 89 ms | < 2.000 ms |
| Prognoseaktualisierung für 300 Umläufe | 89 ms | < 2.000 ms |

Diese Referenzmessung dokumentiert den damaligen lokalen Nachweis. Sie wird im normalen
GitHub-`check` nicht mehr als unveränderter Zwei-Sekunden-Produktionsgrenzwert interpretiert.

## Getrennte Cloudflare-SLO-Messung

Die harte Zwei-Sekunden-Grenze für das Mengengerüst wird separat gegen eine bereitgestellte
Cloudflare-Abnahmeumgebung gemessen. Der bewusst gestartete Kommandozeilenlauf verlangt:

- die HTTPS-Origin eines Workers mit `APP_ENV=acceptance`,
- eine ausschließlich synthetische Veranstaltung mit einer ID beginnend mit `perf-`,
- das vollständige Q-PER-020-Mengengerüst und mindestens 20 sichtbare Board-Zeilen sowie
- die ausdrückliche Bestätigung `PERFORMANCE`.

Der Lauf ist strikt read-only: Er öffnet 20 öffentliche WebSocket-Verbindungen und führt
standardmäßig drei Runden mit jeweils 20 parallelen Board-Projektionen aus. Der Worker liefert dafür
`Server-Timing: public-board;dur=...`; dadurch bewertet die harte Grenze die Ausführungszeit auf
Cloudflare und nicht die CPU-Leistung des GitHub-Runners. Sowohl die initiale Projektion als auch das
p95 aller serverseitigen Parallelmessungen müssen unter 2.000 ms bleiben. Die zusätzliche
Client-p95-Zeit wird nur diagnostisch ausgegeben.

Der read-only Lauf wird mit den erforderlichen Prozessvariablen gestartet:

```bash
CLOUDFLARE_SCALE_TARGET_ORIGIN=https://example.workers.dev \
  CLOUDFLARE_SCALE_EVENT_ID=perf-release-1 \
  CLOUDFLARE_SCALE_CONFIRMATION=PERFORMANCE \
  npm run test:cloudflare-scale-performance
```

Dieser Cloudflare-Lauf belegt den lesenden Skalierungspfad aus Q-PER-020. Er verkauft bewusst kein
Ticket und erzeugt weder Ticket-, Audit- noch Outbox-Daten. Der serverseitige Standardverkauf aus
Q-PER-010 und die persistierte Prognoseneuberechnung aus Q-PER-030 werden im lokalen Skalierungslauf
weiter funktional und mit Messwerten geprüft; ihre formale Zwei-Sekunden-Abnahme bleibt ein
kontrollierter Abnahmepunkt auf der isolierten Testumgebung und wird nicht durch einen mutierenden
GitHub-Workflow automatisiert.

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

## Nachmessung des verkürzten Kassenpfads

Am 30. Juli 2026 wurde der Skalierungslauf nach der Trennung von persistiertem Verkauf und
nachlaufendem Ansichtsabgleich erneut ausgeführt:

| Messpunkt | Ergebnis | Grenze |
| --- | ---: | ---: |
| Operationssicht | 90 ms | < 2.000 ms |
| 20 parallele Geräte, p95 | 1.212 ms | < 2.000 ms |
| Historie | 52 ms | < 2.000 ms |
| Kassenliste Seite 1 / Seite 2 | 18 ms / 14 ms | jeweils < 2.000 ms |
| gezielte Kassen-Revalidierung | 15 ms | < 2.000 ms |
| serverseitige Verkaufsbestätigung | 29 ms | < 2.000 ms |
| Forecast für 300 Umläufe | 285 ms | < 2.000 ms |

Der Test verlangt nun zusätzlich zu Warteschlangen- und Gesamtkommandozeit die
datenschutzneutralen Phasen `sale-preflight` und `sale-persist` im `Server-Timing`-Header.
Auditierung, Idempotenzbeleg, Outbox und fachliche Mutation bleiben vollständig im vor der
Bestätigung abgewarteten D1-Batch.

## Nachmessung der einheitlichen Forecast-Pipeline

Am 16. August 2026 wurde der identische lokale 300-Umlauf-Datensatz nach ADR-0054 erneut ausgeführt.
Die vollständige Ein-Pass-Prognose einschließlich aktiver Ressourcenprojektion, Dispatch und
Langzeit-Replay benötigte 816 ms und blieb damit unter der geforderten Zwei-Sekunden-Grenze. Der
Parallelabruf über 20 Geräte lag im p95 bei 995 ms statt 1.212 ms in der Messung vom 30. Juli
(-217 ms beziehungsweise -17,9 %). Die Forecastzeit stieg gegenüber 285 ms um 531 ms; der Vergleich
ist bewusst konservativ, weil die neue Messung Objective-Vektor, Suchdiagnostik und faktische
Batchdetails zusätzlich berechnet und persistiert.

Der Nahhorizont bleibt standardmäßig auf 64 Kandidaten je Schritt und Beam-Breite 24 begrenzt.
`DispatchPlan.searchDiagnostics` weist `candidateLimitReached` und `beamLimitReached` getrennt aus.
Der deterministische Domain-Grenztest reduziert beide Grenzen gezielt, erzwingt beide
Trunkierungsfälle und verlangt dennoch bytegleichen Plan, Revision und Objective bei identischer
Eingabe. Der lineare Langzeitschwanz führt keine kombinatorische Beam-Suche aus.

`npm run test:browser:cashier` führte anschließend 30 Verkäufe gegen einen isolierten lokalen
Worker und eine synthetische D1-Datenbank in Microsoft Edge aus:

| Browser-Messpunkt | Median | Maximum | Grenze |
| --- | ---: | ---: | ---: |
| Bereitschaft für den nächsten Verkauf | 23,5 ms | 96,2 ms | < 1.000 ms |
| QR-Erzeugung | 8,5 ms | 29,0 ms | < 2.000 ms |
| vollständige Ansichts- und Belegsynchronisation | 101,2 ms | 240,8 ms | < 2.000 ms |

Der Lauf prüft zusätzlich 44-px-Symbolcontrols, Tastatur- und Pfeilbedienung der
Kassenreihenfolge, Abbrechen/Speichern, Schutz des neuesten Belegs durch das Sequenz-Token sowie
eine fehlgeschlagene Nachsynchronisation, die den bestätigten Verkauf nicht als Fehlschlag
darstellen darf. Stepper und Reset wurden als kompakte Einheit sowie die Reihenfolge-Aktion
geometrisch rechtsbündig nachgewiesen. Light und Dark wurden bei 1440 × 1000, 1024 × 768 und
430 × 900 ohne horizontales Überlaufen abgenommen.

Nicht durch diese lokalen Läufe ersetzt werden der zwölfstündige Langlauf, die
Cloudflare-Verfügbarkeitsmessung oder die Generalprobe auf Originalhardware. Diese Nachweise bleiben
eigene Abnahmepunkte.
