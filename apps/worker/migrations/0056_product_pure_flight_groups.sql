-- Wiederherstellung: Vor Anwendung einen D1-Time-Travel-Punkt beziehungsweise eine portable
-- Sicherung anlegen. SQLite kann die ergänzte Spalte und die Trigger nur durch Wiederherstellung
-- oder kontrollierten Tabellenneuaufbau vollständig zurücknehmen.
ALTER TABLE flight_groups ADD COLUMN product_id TEXT REFERENCES products(id) ON DELETE RESTRICT;

-- Eindeutige Bestandsdaten werden direkt zurückgefüllt. Bei historischen Mischdaten wird ein
-- repräsentatives Produkt für die lesbare Legacy-Zuordnung gewählt; die Trigger betreffen nur
-- neue beziehungsweise reaktivierte aktive Ticketzuweisungen.
UPDATE flight_groups
   SET product_id = (
     SELECT MIN(tg.product_id)
       FROM rotations r
       JOIN rotation_tickets rt ON rt.rotation_id = r.id
       JOIN tickets t ON t.id = rt.ticket_id
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
      WHERE r.flight_group_id = flight_groups.id
   )
 WHERE product_id IS NULL;

CREATE INDEX idx_flight_groups_event_product
  ON flight_groups(operation_day_id, product_id, status, communication_number);

CREATE TRIGGER rotation_tickets_product_pure_insert
BEFORE INSERT ON rotation_tickets
WHEN NEW.released_at IS NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM rotations r
      JOIN flight_groups fg ON fg.id = r.flight_group_id
      JOIN tickets t ON t.id = NEW.ticket_id
      JOIN ticket_groups tg ON tg.id = t.ticket_group_id
     WHERE r.id = NEW.rotation_id
       AND r.status NOT IN ('COMPLETED', 'CANCELED')
       AND (fg.product_id IS NULL OR fg.product_id <> tg.product_id)
  ) THEN RAISE(ABORT, 'active rotation ticket product mismatch') END;
END;

CREATE TRIGGER rotation_tickets_product_pure_reactivate
BEFORE UPDATE OF released_at ON rotation_tickets
WHEN NEW.released_at IS NULL AND OLD.released_at IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM rotations r
      JOIN flight_groups fg ON fg.id = r.flight_group_id
      JOIN tickets t ON t.id = NEW.ticket_id
      JOIN ticket_groups tg ON tg.id = t.ticket_group_id
     WHERE r.id = NEW.rotation_id
       AND r.status NOT IN ('COMPLETED', 'CANCELED')
       AND (fg.product_id IS NULL OR fg.product_id <> tg.product_id)
  ) THEN RAISE(ABORT, 'active rotation ticket product mismatch') END;
END;
