ALTER TABLE operation_days ADD COLUMN max_ticket_deferrals INTEGER NOT NULL DEFAULT 2
  CHECK (max_ticket_deferrals BETWEEN 1 AND 10);

ALTER TABLE ticket_groups ADD COLUMN deferral_count INTEGER NOT NULL DEFAULT 0
  CHECK (deferral_count >= 0);
