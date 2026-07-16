# Migration 0034 – automatischer Voraufruf

Betroffene Anforderungen: F-BEN-030, F-MON-010, F-SLT-060 und Q-ZUV-040.

## Zweck

Die Migration trennt den öffentlichen Voraufruf `GO TO GATE` von `NEXT`. Sie speichert nur
technische Fluggruppen-, Ressourcen- und Gate-IDs. Ein Voraufruf weist kein Flugzeug oder einen
Pilotencode zu und besitzt keine flugbetriebliche Freigabewirkung.

## Anwendung in Cloudflare

Vorher eine portable D1-Sicherung erzeugen. Danach im Projektverzeichnis ausführen:

```powershell
npm run db:migrations:remote:status
npm run db:migrate:remote
```

Die Rückfrage muss `0034_automatic_precall.sql` nennen. Danach wird der zugehörige Worker deployt.

## Wiederherstellung

Bei einem Fehler den Worker auf die vorherige Version zurücksetzen und die vor der Migration
erzeugte D1-Sicherung beziehungsweise D1 Time Travel verwenden. Die Spalten sind additiv; ein
älterer Worker ignoriert sie, solange keine neuen Voraufrufe mehr erzeugt werden.
