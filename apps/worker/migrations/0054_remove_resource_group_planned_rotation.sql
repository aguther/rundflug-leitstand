-- Wiederherstellung: Vor Anwendung einen D1-Time-Travel-Punkt beziehungsweise eine portable
-- Sicherung anlegen; für die Rückkehr zum alten Schema ist daraus vollständig wiederherzustellen.
ALTER TABLE resource_groups DROP COLUMN planned_rotation_minutes;
