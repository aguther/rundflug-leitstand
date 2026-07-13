-- Der Werksreset darf den append-only Ledger nur innerhalb einer kontrollierten D1-Transaktion
-- leeren. Wiederherstellung: vor dem Rollback ein portables R2-Backup einspielen; anschließend
-- diesen Trigger wieder durch die bedingungslose Variante aus 0001_initial.sql ersetzen und die
-- beiden system_reset_* Tabellen entfernen.
CREATE TABLE system_reset_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
) STRICT;

INSERT INTO system_reset_control (singleton, active) VALUES (1, 0);

CREATE TABLE system_reset_receipts (
  command_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  r2_cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (r2_cleanup_pending IN (0, 1)),
  response_json TEXT NOT NULL CHECK (json_valid(response_json))
) STRICT;

DROP TRIGGER operational_events_no_delete;

CREATE TRIGGER operational_events_no_delete
BEFORE DELETE ON operational_events
WHEN (SELECT active FROM system_reset_control WHERE singleton = 1) = 0
BEGIN
  SELECT RAISE(ABORT, 'operational_events is append-only');
END;
