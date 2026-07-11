-- Web-Push-Ziele sind pseudonyme Kontaktdaten und bleiben vom operativen Kern getrennt.
-- Wiederherstellung: Tabelle aus dem letzten portablen Backup wiederherstellen; ein Rollback kann
-- die Tabelle gefahrlos entfernen, deaktiviert dann aber alle bestehenden Einwilligungen.
CREATE TABLE web_push_subscriptions (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id),
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  delete_after TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_web_push_ticket_active
  ON web_push_subscriptions(ticket_id, status, delete_after);
