ALTER TABLE rotations ADD COLUMN gate_id TEXT REFERENCES gates(id) ON DELETE RESTRICT;
ALTER TABLE rotations ADD COLUMN operational_note TEXT NOT NULL DEFAULT '';

UPDATE rotations
   SET gate_id = COALESCE(
     (
       SELECT p.gate_id
         FROM rotation_tickets rt
         JOIN tickets t ON t.id = rt.ticket_id
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         JOIN products p ON p.id = tg.product_id
        WHERE rt.rotation_id = rotations.id
        ORDER BY rt.assigned_at
        LIMIT 1
     ),
     (
       SELECT rg.gate_id
         FROM flight_groups fg
         JOIN resource_groups rg ON rg.id = fg.resource_group_id
        WHERE fg.id = rotations.flight_group_id
     )
   )
 WHERE gate_id IS NULL;

CREATE INDEX idx_rotations_event_gate ON rotations(operation_day_id, gate_id, status);
