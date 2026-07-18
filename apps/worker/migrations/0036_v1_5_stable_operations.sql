-- V1.5 is deployed onto a disposable acceptance database. The nullable declarations only keep
-- local developer databases readable while the new baseline is rolled out; every new ticket and
-- group receives the values at creation time.
ALTER TABLE tickets ADD COLUMN public_code TEXT;
CREATE UNIQUE INDEX idx_tickets_public_code ON tickets(public_code) WHERE public_code IS NOT NULL;

ALTER TABLE ticket_groups ADD COLUMN communication_number INTEGER;
ALTER TABLE ticket_groups ADD COLUMN recalled_at TEXT;
ALTER TABLE ticket_groups ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_ticket_groups_event_communication
  ON ticket_groups(operation_day_id, communication_number)
  WHERE communication_number IS NOT NULL;

ALTER TABLE operation_days ADD COLUMN departed_visibility_seconds INTEGER NOT NULL DEFAULT 15
  CHECK (departed_visibility_seconds BETWEEN 5 AND 900);
ALTER TABLE operation_days ADD COLUMN logo_object_key TEXT;
ALTER TABLE operation_days ADD COLUMN logo_media_type TEXT;
ALTER TABLE operation_days ADD COLUMN logo_updated_at TEXT;
