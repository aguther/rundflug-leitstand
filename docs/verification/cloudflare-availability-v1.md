# Verfügbarkeitsnachweis der zentralen Umgebung V1

Status: Monitor implementiert; vollständiger Veranstaltungs-/Abnahmelauf ausstehend.

Betroffene Anforderung: Q-ZUV-060.

`npm run test:cloudflare-availability` prüft die zentrale Cloudflare-Umgebung standardmäßig zwölf
Stunden lang im Abstand von 60 Sekunden. Ein Messintervall gilt nur dann als verfügbar, wenn alle
drei Schichten erfolgreich und semantisch plausibel antworten:

- die ausgelieferte Web-Anwendung (`/`),
- der Worker-Healthcheck (`/api/health`),
- ein lesender D1-Zugriff (`/api/setup/status`).

Damit wird nicht nur die Erreichbarkeit des Cloudflare-Netzes gemessen. Störungen der statischen
Anwendung, des Workers oder der relationalen Source of Truth machen das gesamte Intervall
nicht verfügbar. Ein Request läuft nach zehn Sekunden in einen Fehler. Geplante Wartung wird weder
im Harness noch im Bericht aus der Messung entfernt.

Der vollständige Abnahmelauf lautet:

```bash
npm run test:cloudflare-availability
```

Eine abweichende zentrale Umgebung muss explizit als HTTPS-Origin gesetzt werden:

```bash
AVAILABILITY_TARGET_ORIGIN=https://example.invalid npm run test:cloudflare-availability
```

Für einen rein funktionalen Vorab-Lauf dürfen Laufzeit und Intervall verkürzt werden:

```bash
AVAILABILITY_DURATION_SECONDS=20 AVAILABILITY_INTERVAL_SECONDS=2 \
  AVAILABILITY_TIMEOUT_SECONDS=2 npm run test:cloudflare-availability
```

Der Abschlussbericht enthält Messzeitraum, Mess- und Ausfallintervalle, Verfügbarkeit, Ausfälle je
Prüfpfad sowie Median, p95 und Maximum der Request-Latenzen. Der Prozess schlägt fehl, wenn weniger
als 99,5 Prozent der Intervalle vollständig verfügbar waren. Der Vorab-Lauf belegt nur die
Funktionsfähigkeit des Monitors; Q-ZUV-060 bleibt bis zu einem erfolgreichen Lauf über den gesamten
maßgeblichen Veranstaltungszeitraum in der Traceability auf `geplant`.

## Verifizierter Vorab-Lauf vom 14. Juli 2026

Der 20-Sekunden-Lauf gegen die zentrale Cloudflare-Umgebung wurde mit einem Zwei-Sekunden-Intervall
erfolgreich abgeschlossen:

- 10 von 10 vollständig verfügbare Messintervalle (100 Prozent),
- keine Ausfälle von Web-Anwendung, Worker-Healthcheck oder lesendem D1-Zugriff,
- Median 39,3 ms, p95 1.291,6 ms und Maximum 1.382,3 ms,
- keine Wartungszeit aus der Messung ausgeschlossen.

Dieser Vorab-Lauf ersetzt nicht den vollständigen Abnahmelauf über den maßgeblichen
Veranstaltungszeitraum.
