-- GO TO GATE und BOARDING benötigen getrennte Zustellbelege und unterschiedliche Gasttexte.
CREATE TABLE web_push_deliveries_next (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  rotation_id TEXT NOT NULL REFERENCES rotations(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'PREPARE_FOR_FLIGHT', 'GO_TO_GATE', 'BOARDING_STARTED', 'FLIGHT_GROUP_CALLED',
    'ROTATION_STARTED', 'ROTATION_LANDED', 'ROTATION_COMPLETED'
  )),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'EXPIRED')),
  queued_at TEXT NOT NULL,
  last_attempt_at TEXT,
  delivered_at TEXT,
  UNIQUE(subscription_id, rotation_id, notification_type)
) STRICT;

INSERT INTO web_push_deliveries_next
  (id, operation_day_id, subscription_id, rotation_id, notification_type, status,
   queued_at, last_attempt_at, delivered_at)
SELECT id, operation_day_id, subscription_id, rotation_id, notification_type, status,
       queued_at, last_attempt_at, delivered_at
  FROM web_push_deliveries;

DROP TABLE web_push_deliveries;
ALTER TABLE web_push_deliveries_next RENAME TO web_push_deliveries;

CREATE INDEX idx_web_push_deliveries_pending
  ON web_push_deliveries(status, queued_at) WHERE status = 'PENDING';
