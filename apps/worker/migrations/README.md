# D1-Migrationen

## 0001 – V1.12-Schema-Baseline

`0001_v1_12_baseline.sql` ist das vollständige Startschema für eine leere Installation des
Rundflug-Leitstands V1.12. Es ersetzt bewusst die historische Folge aus 69 Dateien von
`0001_initial.sql` bis `0068_booking_segment_order.sql`, einschließlich der früheren doppelten
Nummer `0036`.

Die Baseline wurde aus dem tatsächlich ausgeführten Endzustand der bisherigen Migrationen erzeugt.
Das semantische Referenzmanifest unter `apps/worker/test-support/v1-12-schema-manifest.json`
dokumentiert Tabellen, Spalten, Fremdschlüssel, Indizes und Trigger dieses Zustands. Ein Test führt
die Baseline in SQLite aus und vergleicht die resultierende Struktur mit diesem Manifest.

### Anwendung

- Die Datei darf ausschließlich auf eine leere D1-Datenbank angewendet werden.
- Wrangler erzeugt und pflegt die interne Tabelle `d1_migrations`; sie ist kein Bestandteil der
  Baseline.
- Produktive oder zu erhaltende Bestände werden nicht aus den historischen Migrationen übernommen.
- Nach der Anwendung müssen `PRAGMA foreign_key_check`, Schema-Verifikation und Runtime-Tests
  erfolgreich sein.

### Wiederherstellung

Diese Baseline besitzt absichtlich keinen SQL-Rollback. Bei einem Fehler wird die noch nicht
produktive D1-Datenbank gelöscht, in EU-Jurisdiktion neu angelegt und die Baseline erneut angewendet.
Vor dem Löschen eines Cloudflare-Ziels müssen der administrative Factory Reset, die Bereinigung der
zugehörigen Durable Objects und die R2-Bereinigung bestätigt sein. Vorhandene Nutzdaten werden dabei
bewusst verworfen.

### Folgemigrationen

Neue Migrationen beginnen mit `0002_<english-slug>.sql`. Nummern sind vierstellig, eindeutig und
lückenlos. Jede Folgemigration enthält eine Wiederherstellungs- oder Forward-Repair-Notiz und wird
durch ausgeführte Schema- oder Verhaltenstests abgesichert.

## 0002 – Planning-run lineage indexes

`0002_planning_run_lineage_indexes.sql` ergänzt direkte Indizes auf `planning_runs.anchor_run_id`
und `planning_runs.previous_run_id`. Damit kann D1 die selbstreferenzierenden Fremdschlüssel bei der
begrenzten Werksreset-Löschung prüfen, ohne für jede Zeile die vollständige Planlaufhistorie zu
durchsuchen. Die Migration verändert keine Nutzdaten.

### Wiederherstellung

Bei einem fehlgeschlagenen oder inkonsistenten Indexaufbau werden beide Indizes mit `DROP INDEX IF
EXISTS` entfernt und die korrigierte Migration erneut angewendet. Vor dem Rückbau wird der
Werksreset angehalten; ein bereits laufender Reset wird anschließend mit demselben autorisierten
Vorgang fortgesetzt.
