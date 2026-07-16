# Migration 0033 – anonyme Flight-Line-Assist-Betreuung

Betroffene Anforderungen: F-INT-070, Q-UX-020 und Q-ZUV-040.

## Zweck

Die Migration legt eine kurzlebige technische Reservierung je Flugzeug an. Sie koordiniert mehrere
Assist-Geräte, ohne Namen, Telefonnummern oder sonstige personenbezogene Daten zu speichern. Eine
Reservierung läuft nach 45 Sekunden ohne Erneuerung ab und ersetzt weder fachliche Zustandskommandos
noch deren Versions- und Idempotenzprüfung.

## Anwendung in Cloudflare

Vorher eine portable D1-Sicherung erzeugen. Danach im Projektverzeichnis ausführen:

```powershell
npm run db:migrations:remote:status
npm run db:migrate:remote
```

Die Rückfrage muss Migration `0033_flight_line_assist_claims.sql` nennen. Anschließend den Worker
deployen und mit zwei gekoppelten Flight-Line-Geräten prüfen, dass ein bereits übernommenes Flugzeug
auf dem zweiten Gerät nicht erneut übernommen werden kann.

## Wiederherstellung

Bei einem Fehler den Worker auf die vorherige Version zurücksetzen und die vor der Migration
erzeugte D1-Sicherung wiederherstellen. Da die Tabelle ausschließlich auslaufende Koordinationsdaten
enthält, kann sie für einen isolierten technischen Rollback auch gelöscht werden; fachliche
Betriebsereignisse bleiben davon unberührt.
