-- Release 1.10.0: Ein nachweislich autorisierter Werksreset darf im selben Browser ohne
-- Cloudflare-Konsole in die Ersteinrichtung übergehen. Der Grant bleibt nur als Hash im
-- idempotenten Reset-Beleg erhalten und verfällt nach 30 Minuten.
-- Wiederherstellung: Vor einem Rollback D1 Time Travel beziehungsweise ein portables R2-Backup
-- verwenden. Ältere Worker ignorieren die zusätzlichen Spalten; ein Rollback darf sie deshalb
-- zunächst bestehen lassen.
ALTER TABLE system_reset_receipts ADD COLUMN setup_grant_hash TEXT;
ALTER TABLE system_reset_receipts ADD COLUMN setup_grant_expires_at TEXT;
ALTER TABLE system_reset_receipts ADD COLUMN setup_grant_used_at TEXT;
ALTER TABLE system_reset_receipts ADD COLUMN setup_browser_binding_hash TEXT;

CREATE INDEX idx_system_reset_receipts_setup_grant
  ON system_reset_receipts(setup_grant_hash, setup_grant_expires_at, setup_grant_used_at);
