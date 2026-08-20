# Freigegebene Referenzen: Simulator-Mehrfachlauf

Stand: 18. August 2026

Die drei PNG-Dateien sind die unveränderten, vor der Implementierung freigegebenen Referenzen:

- `main-screen.png`: Hauptscreen mit gruppierter Sidebar, Wiedergabe, zwei Tagesdiagrammen und fünf Kennzahlenkarten;
- `batch-operation.png`: Mehrfachlauf, Tab **Betrieb**;
- `batch-forecast.png`: Mehrfachlauf, Tab **Prognose**.

Sie dienen ausschließlich dem visuellen Rendervergleich. Fachliche Definitionen und Akzeptanzgrenzen
stehen in `docs/verification/forecast-simulator-baseline-v1.md`.

Die am 20. August 2026 freigegebene kompakte Zeitdiagrammsteuerung ersetzt in allen gerenderten
Oberflächen eine sichtbare Zoomstufenanzeige durch drei quadratische Symbolbuttons. Nur die
Simulator-Hauptzeitleiste ergänzt separat das Symbol **Aktuell folgen** und startet in der
Gesamtansicht. Diese gezielte Control-Anpassung verändert keine übrige Flucht oder Dialogstruktur der
PNG-Referenzen.
