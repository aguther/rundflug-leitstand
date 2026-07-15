# Migration 0032 – Prognosehistorie beim Werksreset

Betroffen ist der vom Auftraggeber freigegebene vollständige Werksreset. Die fachlichen
Append-only-Vorgaben für Prognose- und Auditdaten bleiben im Normalbetrieb unverändert bestehen.

## Zweck

`forecast_snapshots` ist im Normalbetrieb append-only. Der ursprüngliche Löschtrigger aus Migration
0018 berücksichtigte den kontrollierten Werksreset aus Migration 0028 jedoch nicht. Sobald eine
Veranstaltung bereits Prognose-Snapshots enthielt, wurde deshalb der gesamte atomare Reset-Batch
abgewiesen. Ein leerer Demo-Seed verdeckte diesen Fehler.

Migration 0032 ersetzt ausschließlich den Löschtrigger. Löschen bleibt weiterhin verboten, außer
`system_reset_control.active` ist innerhalb des geschützten D1-Batches auf `1` gesetzt. Updates an
Prognose-Snapshots bleiben ausnahmslos verboten.

## Einspielen und Prüfung

1. Vor dem Einspielen ein portables R2-Backup beziehungsweise einen D1-Export erstellen.
2. Migration mit `npm run db:migrate:remote` anwenden.
3. `npm run test:factory-reset` und anschließend `npm run check` ausführen.
4. Den Werksreset in der Abnahmeumgebung nur mit synthetischen Daten über die Administration prüfen.

## Wiederherstellung

Ein Rückbau des Triggers in der laufenden Datenbank würde einen funktionierenden Werksreset erneut
blockieren und ist nicht vorgesehen. Bei einem Fehler wird der vor der Migration gesicherte D1-Stand
in eine neue Datenbank wiederhergestellt und die Worker-Bindung zurückgesetzt. Die Migration ändert
keine Daten und keine Tabellenspalten.
