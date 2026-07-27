-- Veranstaltungslöschungen benötigen einen veranstaltungsunabhängigen Idempotenzbeleg, weil die
-- regulären Belege zusammen mit der Veranstaltung entfernt werden. Der Beleg enthält weder
-- Veranstaltungsinhalte noch Klartext-Begründungen oder Zugangstoken.
--
-- Wiederherstellung: Vor einem Rollback D1 Time Travel beziehungsweise eine vollständige
-- D1-Sicherung verwenden. Ein älterer Worker ignoriert diese additive Tabelle; sie darf erst nach
-- dem Rollback des Workers entfernt werden.
CREATE TABLE event_deletion_receipts (
  command_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  source_operation_day_id TEXT NOT NULL,
  target_operation_day_id TEXT NOT NULL,
  target_version INTEGER NOT NULL CHECK (target_version >= 0),
  actor_device_id TEXT NOT NULL,
  browser_binding_hash TEXT CHECK (
    browser_binding_hash IS NULL OR length(browser_binding_hash) = 64
  ),
  legacy_credential_hash TEXT CHECK (
    legacy_credential_hash IS NULL OR length(legacy_credential_hash) = 64
  ),
  completed_at TEXT NOT NULL,
  r2_cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (r2_cleanup_pending IN (0, 1)),
  logo_object_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(logo_object_keys_json)),
  response_json TEXT NOT NULL CHECK (json_valid(response_json))
) STRICT;

CREATE INDEX idx_event_deletion_receipts_target
  ON event_deletion_receipts(target_operation_day_id, completed_at);
