-- Wiederherstellung: Vor Anwendung einen D1-Time-Travel-Punkt beziehungsweise eine portable
-- Sicherung anlegen. Die additive, nullable Kontoreferenz und der Suchindex können von älteren
-- Workern ignoriert werden; für eine vollständige Schema-Rückkehr wird D1 auf den Stand vor 0059
-- zurückgesetzt oder aus der Sicherung wiederhergestellt.
ALTER TABLE ticket_groups ADD COLUMN sold_by_operator_account_id TEXT
  REFERENCES operator_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_ticket_groups_cashier_account_list
  ON ticket_groups(operation_day_id, sold_by_operator_account_id, sold_at DESC, id DESC);
