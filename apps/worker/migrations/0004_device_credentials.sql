ALTER TABLE paired_devices ADD COLUMN credential_hash TEXT;

CREATE INDEX idx_paired_devices_credential
  ON paired_devices(operation_day_id, id, active, credential_hash);
