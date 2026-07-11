-- Organisatorische Hinweise besitzen ausdrücklich keine sicherheitsbezogene Freigabewirkung.
ALTER TABLE resource_groups ADD COLUMN operational_note TEXT NOT NULL DEFAULT '';
