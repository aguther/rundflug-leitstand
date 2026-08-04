-- Persist the exact planning version and draft rotation members behind each recommendation lease.
-- Existing leases are historical only; the defaults keep them readable but they cannot match a
-- current positive operation-day version or a non-empty member set.
-- Recovery: restore D1 with Time Travel or a portable R2 backup before rolling back the Worker.
-- Older Workers ignore both additive columns, so they may remain in place during rollback.
ALTER TABLE dispatch_recommendation_leases
  ADD COLUMN operation_day_version INTEGER NOT NULL DEFAULT 0 CHECK (operation_day_version >= 0);

ALTER TABLE dispatch_recommendation_leases
  ADD COLUMN member_rotation_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(member_rotation_ids_json));
