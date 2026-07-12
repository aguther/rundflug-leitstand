-- Ausschließlich organisatorische, nicht personenbezogene Bemerkung zum anonymen Pilotencode.
ALTER TABLE pilots ADD COLUMN operational_note TEXT NOT NULL DEFAULT '';
