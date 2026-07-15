-- Erlaubt das Leeren des append-only Prognoseverlaufs ausschließlich innerhalb des bereits durch
-- Migration 0028 geschützten Werksreset-Batches. Im Normalbetrieb bleiben Löschungen verboten.
DROP TRIGGER forecast_snapshots_no_delete;

CREATE TRIGGER forecast_snapshots_no_delete
BEFORE DELETE ON forecast_snapshots
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'forecast_snapshots is append-only');
END;
