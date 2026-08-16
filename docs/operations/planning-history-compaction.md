# Betrieb der Planungshistorien-Kompaktion

## Normalbetrieb

Der Cron `0 * * * *` startet faire, idempotente Workflow-Instanzen. Jede Instanz verarbeitet genau
ein Segment. Der tägliche Lauf `15 2 * * *` führt zusätzlich Paket-Retention und die übrige Wartung
aus. Erwartete Zustände sind `PENDING`, kurzzeitig `BUILDING`, anschließend `VERIFIED`/`PRUNING` und
schließlich `COMPLETED`.

In Produktion müssen folgende Variablen gesetzt sein:

```text
PLANNING_DETAIL_RETENTION_HOURS=24
PLANNING_HISTORY_RETENTION_YEARS=5
```

Zulässige Bereiche sind 24–168 Stunden und fünf bis zehn Kalenderjahre. Das Workflow-Binding heißt
`PLANNING_HISTORY_COMPACTION`; die R2-Bindung bleibt `BACKUPS`.

## Betriebsprüfung

- Kein Segment darf vor `VERIFIED` D1-Zeilen verlieren.
- `BUILDING` ohne ZIP ist retry-fähig; ZIP ohne Sidecar wird durch erneutes Hashen repariert.
- Sidecar ohne ZIP oder abweichender Hash ist ein Integritätsalarm und darf nicht automatisch
  bereinigt werden.
- `CAPTURING` im Segment ist ein erwarteter Blocker. Der Capture-Fehler wird zuerst fachlich
  geklärt; der Kompaktor überspringt ihn nicht.
- Ein dauerhaft aktiver `planning_history_maintenance_control` ist ein Alarm. Vor Eingriff müssen
  Kompaktions-ID, Veranstaltung und Boundary gegen den Katalog geprüft werden.
- Für aktive Veranstaltungen verbleiben höchstens Detailfenster plus erster Fortsetzungsanker; für
  `CLOSED`/`ARCHIVED` muss der Rest nach Ablauf des Fensters terminal verschwinden.

## Retention und Löschung

Der Anwendungslauf markiert abgelaufene Pakete, löscht ZIP und Sidecar gemeinsam und protokolliert
`PACKAGE_EXPIRED`. Veranstaltungslöschung löscht den gesamten Präfix
`planning-history/<event-id>/` sowie Katalog und Ereignisse. Der Werksreset behandelt diese Tabellen
in der Support-Phase und leert R2 nur, wenn die entsprechende Reset-Option bestätigt wurde.

Ein Bucket-Lifecycle ist ausschließlich ein späteres Sicherheitsnetz. Er darf niemals kürzer als
die katalogisierte Retention sein und gilt nicht als erfolgreicher Anwendungsbeleg.

## Recovery

Kein Restore erfolgt direkt in die gebundene D1. Vorgehen und Prüfungen stehen im
[Retention-/Restore-Vertrag](../architecture/planning-history-compaction/retention-and-restore.md).
Ein Rückbau der Migration ist ausgeschlossen; bei beschädigtem Produktionsbestand wird eine neue
isolierte D1 aufgebaut, vollständig geprüft und erst danach kontrolliert gebunden.
