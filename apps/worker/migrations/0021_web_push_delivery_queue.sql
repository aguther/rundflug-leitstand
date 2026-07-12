-- Zustellaufträge sind pseudonyme, befristete Push-Metadaten und werden mit dem Abonnement gelöscht.
CREATE TABLE web_push_deliveries (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  rotation_id TEXT NOT NULL REFERENCES rotations(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'PREPARE_FOR_FLIGHT', 'FLIGHT_GROUP_CALLED', 'ROTATION_STARTED',
    'ROTATION_LANDED', 'ROTATION_COMPLETED'
  )),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'EXPIRED')),
  queued_at TEXT NOT NULL,
  last_attempt_at TEXT,
  delivered_at TEXT,
  UNIQUE(subscription_id, rotation_id, notification_type)
) STRICT;

CREATE INDEX idx_web_push_deliveries_pending
  ON web_push_deliveries(status, queued_at) WHERE status = 'PENDING';
