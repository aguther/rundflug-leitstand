PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN reference_capacity INTEGER NOT NULL DEFAULT 1 CHECK (reference_capacity > 0);
ALTER TABLE products ADD COLUMN reference_duration_minutes INTEGER NOT NULL DEFAULT 20 CHECK (reference_duration_minutes > 0);
ALTER TABLE products ADD COLUMN sale_closes_at TEXT;
ALTER TABLE tickets ADD COLUMN payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('CASH', 'CARD', 'VOUCHER', 'OTHER'));
ALTER TABLE aircraft ADD COLUMN operational_state TEXT NOT NULL DEFAULT 'AVAILABLE'
  CHECK (operational_state IN ('AVAILABLE', 'BOARDING', 'IN_FLIGHT', 'LANDED', 'TURNAROUND', 'REFUELING', 'PAUSED', 'INACTIVE'));

CREATE INDEX idx_rotations_event_status ON rotations(operation_day_id, status, created_at);
