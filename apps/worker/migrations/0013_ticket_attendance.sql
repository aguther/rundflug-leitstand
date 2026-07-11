ALTER TABLE tickets ADD COLUMN attendance_status TEXT NOT NULL DEFAULT 'NOT_CHECKED_IN'
  CHECK (attendance_status IN ('NOT_CHECKED_IN', 'CHECKED_IN'));
CREATE INDEX idx_tickets_attendance ON tickets(ticket_group_id, attendance_status);
