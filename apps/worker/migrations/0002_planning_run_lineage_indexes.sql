-- Add direct child-key indexes for the self-referencing planning-run lineage.
--
-- Recovery / forward repair:
-- These indexes contain no application data. If this migration must be repaired,
-- drop both indexes and apply the corrected migration again before retrying a
-- factory reset:
--   DROP INDEX IF EXISTS idx_planning_runs_anchor_run;
--   DROP INDEX IF EXISTS idx_planning_runs_previous_run;

-- IF NOT EXISTS also repairs acceptance targets where these indexes were
-- temporarily shipped inside the baseline before its identity was frozen.
CREATE INDEX IF NOT EXISTS idx_planning_runs_anchor_run
  ON planning_runs(anchor_run_id);

CREATE INDEX IF NOT EXISTS idx_planning_runs_previous_run
  ON planning_runs(previous_run_id);
