-- Release 1.8.0: ein stabiler, geschützter öffentlicher Statuscode je Buchungsgruppe und
-- gruppenbezogene Push-Abonnements. Vor Anwendung ist eine D1-Time-Travel-Marke beziehungsweise
-- eine vollständige D1-Sicherung anzulegen. Ein Rollback erfolgt per D1 Time Travel oder aus
-- dieser Sicherung, weil D1 additive Spalten nicht ohne Tabellenneuaufbau entfernen kann.

ALTER TABLE ticket_groups ADD COLUMN public_status_code_hash TEXT;
ALTER TABLE ticket_groups ADD COLUMN public_status_code TEXT;

UPDATE ticket_groups
   SET public_status_code_hash = (
         SELECT t.public_code_hash
           FROM tickets t
          WHERE t.ticket_group_id = ticket_groups.id
          ORDER BY t.created_at, t.id
          LIMIT 1
       ),
       public_status_code = (
         SELECT t.public_code
           FROM tickets t
          WHERE t.ticket_group_id = ticket_groups.id
            AND t.public_code IS NOT NULL
          ORDER BY t.created_at, t.id
          LIMIT 1
       )
 WHERE public_status_code_hash IS NULL;

CREATE UNIQUE INDEX idx_ticket_groups_public_status_code_hash
  ON ticket_groups(public_status_code_hash)
  WHERE public_status_code_hash IS NOT NULL;

CREATE UNIQUE INDEX idx_ticket_groups_public_status_code
  ON ticket_groups(public_status_code)
  WHERE public_status_code IS NOT NULL;

ALTER TABLE web_push_subscriptions ADD COLUMN ticket_group_id TEXT
  REFERENCES ticket_groups(id);

UPDATE web_push_subscriptions
   SET ticket_group_id = (
         SELECT t.ticket_group_id
           FROM tickets t
          WHERE t.id = web_push_subscriptions.ticket_id
       )
 WHERE ticket_group_id IS NULL;

CREATE INDEX idx_web_push_ticket_group_active
  ON web_push_subscriptions(ticket_group_id, status, delete_after);
