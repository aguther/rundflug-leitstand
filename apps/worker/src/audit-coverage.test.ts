import { describe, expect, it } from "vitest";
import { createMigratedTestDatabase } from "../test-support/migrated-database";

describe("append-only operational audit coverage", () => {
  it("prevents updates and deletes at the D1 source of truth", () => {
    const database = createMigratedTestDatabase();
    database.exec(`
      INSERT INTO operation_days (id, name, event_date, created_at, updated_at)
      VALUES ('audit-event', 'Synthetic', '2026-08-15', '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z');
      INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json)
      VALUES ('audit-entry', 'audit-event', 'SYNTHETIC', '2026-08-15T08:00:00Z',
              'synthetic-device', 'OPERATION_DAY', 'audit-event', 0, '{}');
    `);

    expect(() =>
      database.prepare("UPDATE operational_events SET event_type = 'CHANGED'").run(),
    ).toThrow(/append-only/);
    expect(() => database.prepare("DELETE FROM operational_events").run()).toThrow(/append-only/);
    database.close();
  });
});
