-- V1.11: Öffentliche Nachrufe sind eigenständige, temporäre und gruppenspezifische Vorgänge.
CREATE TABLE ticket_group_recalls (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  ticket_group_id TEXT NOT NULL REFERENCES ticket_groups(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT CHECK (end_reason IN (
    'MANUAL', 'PRESENT', 'BOARDING', 'DEFERRED', 'NO_SHOW', 'CANCELED', 'EXPIRED'
  )),
  CHECK (expires_at > started_at),
  CHECK (
    (ended_at IS NULL AND end_reason IS NULL)
    OR (ended_at IS NOT NULL AND end_reason IS NOT NULL)
  ),
  UNIQUE(ticket_group_id, sequence)
) STRICT;

CREATE UNIQUE INDEX uq_ticket_group_recalls_active
  ON ticket_group_recalls(ticket_group_id)
  WHERE ended_at IS NULL;

CREATE INDEX idx_ticket_group_recalls_event_active
  ON ticket_group_recalls(operation_day_id, expires_at)
  WHERE ended_at IS NULL;

-- Rotations- und Nachrufzustellungen verwenden unterschiedliche, fachlich passende Deduplizierung.
CREATE TABLE web_push_deliveries_next (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  rotation_id TEXT REFERENCES rotations(id) ON DELETE CASCADE,
  ticket_group_recall_id TEXT REFERENCES ticket_group_recalls(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'PREPARE_FOR_FLIGHT', 'GO_TO_GATE', 'BOARDING_STARTED', 'FLIGHT_GROUP_CALLED',
    'ROTATION_STARTED', 'ROTATION_LANDED', 'ROTATION_COMPLETED', 'TICKET_GROUP_RECALL'
  )),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'EXPIRED')),
  queued_at TEXT NOT NULL,
  last_attempt_at TEXT,
  delivered_at TEXT,
  CHECK (
    (
      notification_type = 'TICKET_GROUP_RECALL'
      AND rotation_id IS NULL
      AND ticket_group_recall_id IS NOT NULL
    )
    OR (
      notification_type <> 'TICKET_GROUP_RECALL'
      AND rotation_id IS NOT NULL
      AND ticket_group_recall_id IS NULL
    )
  )
) STRICT;

INSERT INTO web_push_deliveries_next
  (id, operation_day_id, subscription_id, rotation_id, ticket_group_recall_id,
   notification_type, status, queued_at, last_attempt_at, delivered_at)
SELECT id, operation_day_id, subscription_id, rotation_id, NULL,
       notification_type, status, queued_at, last_attempt_at, delivered_at
  FROM web_push_deliveries;

DROP TABLE web_push_deliveries;
ALTER TABLE web_push_deliveries_next RENAME TO web_push_deliveries;

CREATE UNIQUE INDEX uq_web_push_deliveries_rotation
  ON web_push_deliveries(subscription_id, rotation_id, notification_type)
  WHERE rotation_id IS NOT NULL;

CREATE UNIQUE INDEX uq_web_push_deliveries_recall
  ON web_push_deliveries(subscription_id, ticket_group_recall_id)
  WHERE ticket_group_recall_id IS NOT NULL;

CREATE INDEX idx_web_push_deliveries_pending
  ON web_push_deliveries(status, queued_at) WHERE status = 'PENDING';
