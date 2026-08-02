-- Kontobezogene FIDS-Modi, Split-Konfiguration und veranstaltungsbezogene Inhaltsfilter.
-- Vor Anwendung ist eine D1-Time-Travel-Marke beziehungsweise vollständige D1-Sicherung
-- anzulegen. Ein älterer Worker ignoriert die additiven Spalten. Für eine vollständige
-- Schema-Rückkehr wird D1 per Time Travel auf den Stand unmittelbar vor 0061 zurückgesetzt
-- oder aus dieser Sicherung wiederhergestellt. Die portable Backupentscheidung aus ADR-0021
-- bleibt unverändert: Konten, Sitzungen und FIDS-Präferenzen sind nicht Bestandteil des R2-Backups.

ALTER TABLE fids_preferences
  ADD COLUMN view_mode TEXT NOT NULL DEFAULT 'FIXED_PAGE'
  CHECK (view_mode IN ('FIXED_PAGE', 'SPLIT'));

ALTER TABLE fids_preferences
  ADD COLUMN priority_group_count INTEGER NOT NULL DEFAULT 3
  CHECK (priority_group_count BETWEEN 1 AND 19);

ALTER TABLE fids_preferences
  ADD COLUMN rotation_interval_seconds INTEGER NOT NULL DEFAULT 12
  CHECK (rotation_interval_seconds BETWEEN 5 AND 60);

ALTER TABLE fids_preferences
  ADD COLUMN content_filter_json TEXT NOT NULL DEFAULT '{"productIds":[],"gateIds":[]}'
  CHECK (
    json_valid(content_filter_json)
    AND json_type(content_filter_json) = 'object'
    AND json_type(content_filter_json, '$.productIds') = 'array'
    AND json_type(content_filter_json, '$.gateIds') = 'array'
  );
