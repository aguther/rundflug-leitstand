-- Release 1.7.1: Flight-Line-Betreuung gehört zum pseudonymen Operator-Login, nicht zum Gerät.
-- Die bisherigen Claims liefen nach 45 Sekunden aus und sind rein ephemer. Sie werden deshalb
-- bewusst nicht migriert. Vor Anwendung ist eine portable D1-Sicherung erforderlich. Ein Rollback
-- erfolgt per D1 Time Travel beziehungsweise aus dieser Sicherung; der ältere Worker kann die neue
-- Tabellenform nicht verwenden.
PRAGMA foreign_keys = OFF;

ALTER TABLE aircraft ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0);

DROP INDEX IF EXISTS flight_line_assist_claims_by_device;
DROP TABLE IF EXISTS flight_line_assist_claims;

CREATE TABLE flight_line_assist_claims (
  operation_day_id TEXT NOT NULL,
  aircraft_id TEXT NOT NULL,
  operator_account_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (operation_day_id, aircraft_id),
  UNIQUE (operation_day_id, operator_account_id),
  FOREIGN KEY (operation_day_id) REFERENCES operation_days(id) ON DELETE CASCADE,
  FOREIGN KEY (aircraft_id) REFERENCES aircraft(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_account_id) REFERENCES operator_accounts(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX flight_line_assist_claims_by_operator
  ON flight_line_assist_claims(operation_day_id, operator_account_id, expires_at);

PRAGMA foreign_keys = ON;
