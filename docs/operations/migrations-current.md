# Aktuelles Migrationsregister – Release 1.12.0

Diese Datei wird aus `apps/worker/migrations/*.sql` erzeugt. Vollständige Dateinamen sind die
D1-Identität der neu begonnenen V1.12-Historie; angewandte Dateien werden nicht nachträglich
umbenannt. Die vorherigen 69 Entwicklungsmigrationen werden nicht unterstützt und bleiben über Git
nachvollziehbar (ADR-0045).

| Reihenfolge | Datei | Deployment | Prüfsumme |
| ---: | --- | --- | --- |
| 1 | `0001_v1_12_baseline.sql` | nur Erstinstallation | `c5f5bd30ab6a…` |
| 2 | `0002_planning_run_lineage_indexes.sql` | automatisch, online-sicher | `c43e45f2fc38…` |
| 3 | `0003_planning_history_compaction.sql` | automatisch, online-sicher | `33f1ed62bfd0…` |
| 4 | `0004_dispatch_decision_details.sql` | automatisch, online-sicher | `23f2e7d125a5…` |

Gesamt: 4 Migrationen. Wiederherstellungsnotizen werden gegen SQL und
`apps/worker/migrations/README.md` geprüft. Für automatische Deployments werden zusätzlich die
vollständigen SHA-256-Prüfsummen und die explizite Online-Sicherheitsfreigabe aus
`apps/worker/migrations/deployment-safety.json` validiert.
