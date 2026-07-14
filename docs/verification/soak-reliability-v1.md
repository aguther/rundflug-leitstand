# 12-Stunden-Zuverlässigkeitsnachweis V1

Status: Harness implementiert und im Kurzlauf verifiziert; echter 12-Stunden-Abnahmelauf ausstehend.

Betroffene Anforderung: Q-ZUV-050.

`npm run test:soak-reliability` erzeugt zunächst ein unveränderliches Worker-Bundle unter
`.wrangler/soak-runtime`. Anschließend startet es genau einen lokalen Worker-Prozess mit isolierter
lokaler D1-Datenbank unter `.wrangler/soak-state`, standardmäßig auf Port 8797 und ausschließlich
synthetischen anonymen Daten. Quellcode- oder Buildänderungen im normalen Arbeitsbaum lösen dadurch
keinen Reload des Langlauf-Workers aus. Ohne Neustart wiederholt der Lauf standardmäßig zwölf
Stunden lang:

- authentisierten Abruf des Healthchecks und des bestätigten Operationsstands,
- Verkauf eines anonymen QR-Tickets über den realen Kommando-/Durable-Object-Pfad,
- auditiertes Storno desselben Tickets,
- erneuten Board-Abruf mit Prüfung der bestätigten Eventversion,
- Empfang mindestens eines Realtime-Ereignisses je Zustandszyklus,
- harte Zwei-Sekunden-Grenze für jeden Request.

Nur die isolierte Langlaufdatenbank wird vor dem Lauf zurückgesetzt; die normale lokale Entwicklung
unter `.wrangler/state` und Port 8787 bleibt unberührt. PIN, Gerätetoken und öffentliche Ticketcodes
sind ausschließlich synthetisch; sie werden nicht ausgegeben. Der Abschlussbericht enthält Laufzeit,
Zyklen, Requestanzahl, Median, p95, Maximum, Realtime-Nachrichten und den Nachweis, dass der
Worker-Prozess nicht beendet wurde.

Der vollständige Abnahmelauf lautet:

```bash
npm run test:soak-reliability
```

Für einen funktionalen Vorab-Lauf darf ausschließlich die Dauer verkürzt werden:

```bash
SOAK_DURATION_SECONDS=30 SOAK_INTERVAL_SECONDS=2 npm run test:soak-reliability
```

## Verifizierter Vorab-Lauf vom 14. Juli 2026

Der 30-Sekunden-Lauf mit einem Zwei-Sekunden-Intervall wurde ohne Worker-Neustart erfolgreich
abgeschlossen:

- 15 vollständige Zustandszyklen,
- 75 erfolgreiche Requests,
- 46 empfangene Realtime-Nachrichten,
- Median 33,9 ms, p95 42,4 ms und Maximum 57,5 ms,
- ausschließlich anonyme synthetische Daten.

Der Vorab-Lauf weist die Funktionsfähigkeit des Harnesses und des wiederholten Ende-zu-Ende-Pfads
nach. Er ersetzt nicht die geforderte zwölfstündige Beobachtungsdauer.

Die isolierte Ausführung wurde nach Einführung des separaten Persistenzpfads zusätzlich mit 20
Sekunden und Zwei-Sekunden-Intervall geprüft: 10 Zyklen, 50 Requests, 31 Realtime-Nachrichten,
p95 45,8 ms, Maximum 52,9 ms und kein Worker-Neustart. Port 8787 und `.wrangler/state` wurden dabei
nicht verwendet.

Q-ZUV-050 bleibt bis zu einem erfolgreichen ungekürzten Lauf mit mindestens 43.200 Sekunden in der
Traceability auf `in Arbeit`.

## Fehlgeschlagener Abnahmelauf vom 14. Juli 2026

Der erste ungekürzte Versuch ab 08:10 Uhr wurde nach sieben persistierten Zyklen bewusst als
fehlgeschlagen beendet, weil nach dem siebten Zustandszyklus innerhalb von zwei Sekunden kein neues
Realtime-Ereignis erkannt wurde. Bis dahin waren 35 REST-Requests und 14 Schreibkommandos
erfolgreich und der Worker war nicht neu gestartet worden. Dieser Versuch ist kein positiver
Q-ZUV-050-Nachweis.

Die Analyse deckte zusätzlich auf, dass der Harness die Zwei-Sekunden-Grenze zwar nach einer
Antwort prüfte, einen vollständig hängenden Request aber nicht aktiv abbrach. Vor dem Neustart des
Abnahmelaufs wurde deshalb ein harter Request-Abbruch mit `AbortSignal.timeout` ergänzt. Ein
isolierter Reproduktionslauf über 150 Sekunden mit echten 60-Sekunden-Intervallen verlief danach
erfolgreich: drei Zyklen, 15 Requests, zehn Realtime-Nachrichten, Maximum 57,2 ms und kein
Worker-Neustart. Der ungekürzte Lauf muss dennoch vollständig wiederholt werden.

Der zweite ungekürzte Versuch ab 17:44 Uhr scheiterte nach neun persistierten Zyklen am gleichen
Realtime-Kriterium. Die REST-Kommandos, Versionen und Auditereignisse waren erneut vollständig
persistiert. Da der Socket dabei nicht zuverlässig als geschlossen erkennbar war, wurde der
Testclient entsprechend der geforderten Wiederverbindungsstrategie erweitert:

- Heartbeat vor jedem Zustandszyklus,
- Wiederverbindung bei geschlossenem Socket oder ausbleibendem Heartbeat,
- weiterhin zwingender Zustands-Broadcast innerhalb von zwei Sekunden nach den Schreibkommandos,
- getrennte Zählung von Broadcasts, Pongs, Verbindungsabbrüchen und Wiederverbindungen.

Ein anschließender 12-Minuten-Lauf überschritt beide bisherigen Abbruchpunkte erfolgreich:

- 12 Zyklen und 60 erfolgreiche Requests,
- 24 Zustands-Broadcasts und 12 beantwortete Heartbeats,
- keine Wiederverbindung, kein Verbindungsabbruch und kein Worker-Neustart,
- Median 35,0 ms, p95 45,9 ms und Maximum 53,9 ms.

Auch dieser Diagnoselauf ersetzt den ungekürzten 12-Stunden-Nachweis nicht.

Der dritte ungekürzte Versuch ab 22:03 Uhr erreichte 60 Zyklen und knapp eine Stunde. Während eines
parallel ausgeführten vollständigen Projektchecks änderten PWA- und Worker-Builds jedoch beobachtete
Dateien. Der damalige `wrangler dev`-Prozess lud daraufhin neu; der Testclient protokollierte mehrere
WebSocket-Schließungen und brach korrekt ab. Der Versuch ist kein positiver Q-ZUV-050-Nachweis, weil
der geprüfte Worker während des Messzeitraums nicht unverändert blieb.

Daraufhin wurde der Harness auf ein vorab erzeugtes, separates Worker-Bundle mit eigener
Laufzeitkonfiguration umgestellt. Ein gezielt parallel zu einem vollständigen `npm run build`
ausgeführter 60-Sekunden-Isolationstest war erfolgreich:

- 30 Zyklen und 150 erfolgreiche Requests,
- 60 Realtime-Zustandsänderungen und 30 beantwortete Heartbeats,
- keine WebSocket-Schließung, keine Wiederverbindung und kein Worker-Neustart,
- Median 35,4 ms, p95 44,5 ms und Maximum 51,5 ms.

Der ungekürzte Lauf wird auf Basis dieses unveränderlichen Bundles neu gestartet.

Die PWA verwendet denselben 30-Sekunden-Heartbeat nun in Betriebsansichten, öffentlichem
Ticketstatus und FIDS. `pong` bestätigt ausschließlich die Verbindung und löst keinen unnötigen
Board-Abruf aus; ein geschlossener oder fehlerhafter Socket wird über den bestehenden exponentiellen
Reconnect sowie den 15-Sekunden-REST-Fallback wieder aufgenommen.
