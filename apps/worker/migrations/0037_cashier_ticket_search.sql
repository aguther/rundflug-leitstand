CREATE INDEX IF NOT EXISTS idx_ticket_groups_cashier_list
  ON ticket_groups(operation_day_id, sold_at DESC, id DESC);
