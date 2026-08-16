# Aktuelles Migrationsregister – Release 1.12.0

Diese Datei wird aus `apps/worker/migrations/*.sql` erzeugt. Vollständige Dateinamen sind die
D1-Identität der neu begonnenen V1.12-Historie; angewandte Dateien werden nicht nachträglich
umbenannt. Die vorherigen 69 Entwicklungsmigrationen werden nicht unterstützt und bleiben über Git
nachvollziehbar (ADR-0045).

| Reihenfolge | Datei | Hinweis |
| ---: | --- | --- |
| 1 | `0001_v1_12_baseline.sql` | eindeutig und lückenlos ab `0001` |
| 2 | `0002_planning_run_lineage_indexes.sql` | eindeutig und lückenlos ab `0001` |
| 3 | `0003_planning_history_compaction.sql` | eindeutig und lückenlos ab `0001` |
| 4 | `0004_dispatch_decision_details.sql` | eindeutig und lückenlos ab `0001` |

Gesamt: 4 Migrationen. Wiederherstellungsnotizen werden gegen SQL und
`apps/worker/migrations/README.md` geprüft.
