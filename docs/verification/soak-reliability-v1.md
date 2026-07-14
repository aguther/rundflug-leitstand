# 12-Stunden-Zuverlässigkeitsnachweis V1

Status: Harness implementiert und im Kurzlauf verifiziert; echter 12-Stunden-Abnahmelauf ausstehend.

Betroffene Anforderung: Q-ZUV-050.

`npm run test:soak-reliability` startet genau einen lokalen Worker-Prozess mit lokaler D1-Datenbank
und ausschließlich synthetischen anonymen Daten. Ohne Neustart wiederholt der Lauf standardmäßig
zwölf Stunden lang:

- authentisierten Abruf des Healthchecks und des bestätigten Operationsstands,
- Verkauf eines anonymen QR-Tickets über den realen Kommando-/Durable-Object-Pfad,
- auditiertes Storno desselben Tickets,
- erneuten Board-Abruf mit Prüfung der bestätigten Eventversion,
- Empfang mindestens eines Realtime-Ereignisses je Zustandszyklus,
- harte Zwei-Sekunden-Grenze für jeden Request.

Die lokale Datenbank wird vor dem Lauf zurückgesetzt. PIN, Gerätetoken und öffentliche Ticketcodes
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

Q-ZUV-050 bleibt bis zu einem erfolgreichen ungekürzten Lauf mit mindestens 43.200 Sekunden in der
Traceability auf `geplant`.
