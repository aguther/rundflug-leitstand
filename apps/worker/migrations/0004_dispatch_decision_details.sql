-- Persist the factual explanation emitted by the dispatch planner.
--
-- Recovery / forward repair:
-- The nullable additive columns are ignored by the previous Worker and may remain in place
-- during a rollback. SQLite cannot drop them without rebuilding the tables; no rebuild or data
-- repair is required. A corrected Worker may safely overwrite or leave existing NULL values.

ALTER TABLE rotations
  ADD COLUMN dispatch_decision_details_json TEXT
  CHECK (dispatch_decision_details_json IS NULL OR json_valid(dispatch_decision_details_json));

ALTER TABLE forecast_snapshots
  ADD COLUMN dispatch_decision_details_json TEXT
  CHECK (dispatch_decision_details_json IS NULL OR json_valid(dispatch_decision_details_json));

ALTER TABLE dispatch_recommendation_leases
  ADD COLUMN decision_details_json TEXT
  CHECK (decision_details_json IS NULL OR json_valid(decision_details_json));
