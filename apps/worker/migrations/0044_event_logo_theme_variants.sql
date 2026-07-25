-- Bestehende logo_object_key/logo_media_type bleiben die helle Logo-Variante.
-- Die dunkle Variante ist additiv und für Bestandsveranstaltungen zunächst nicht gesetzt.
ALTER TABLE operation_days ADD COLUMN logo_dark_object_key TEXT;
ALTER TABLE operation_days ADD COLUMN logo_dark_media_type TEXT;
