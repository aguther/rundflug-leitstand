// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import migration from "../migrations/0053_distinct_public_push_transitions.sql?raw";

describe("getrennte öffentliche Push-Übergänge in Migration 0053", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE operation_days (id TEXT PRIMARY KEY);
      CREATE TABLE web_push_subscriptions (id TEXT PRIMARY KEY);
      CREATE TABLE rotations (id TEXT PRIMARY KEY);
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
      INSERT INTO operation_days VALUES ('event');
      INSERT INTO web_push_subscriptions VALUES ('subscription');
      INSERT INTO rotations VALUES ('rotation');
      INSERT INTO web_push_deliveries
        (id, operation_day_id, subscription_id, rotation_id, notification_type, status, queued_at)
      VALUES
        ('legacy', 'event', 'subscription', 'rotation', 'FLIGHT_GROUP_CALLED', 'DELIVERED',
         '2026-07-28T10:00:00.000Z');
    `);
  });

  afterEach(() => {
    database.close();
  });

  it("bewahrt Legacy-Belege und erlaubt getrennte GO-TO-GATE-/BOARDING-Belege", () => {
    database.exec(migration);

    expect(
      database
        .prepare("SELECT notification_type, status FROM web_push_deliveries WHERE id = 'legacy'")
        .get(),
    ).toEqual({ notification_type: "FLIGHT_GROUP_CALLED", status: "DELIVERED" });

    const insert = database.prepare(`
      INSERT INTO web_push_deliveries
        (id, operation_day_id, subscription_id, rotation_id, notification_type, queued_at)
      VALUES (?, 'event', 'subscription', 'rotation', ?, '2026-07-28T10:01:00.000Z')
    `);
    insert.run("gate", "GO_TO_GATE");
    insert.run("boarding", "BOARDING_STARTED");

    expect(
      database
        .prepare(
          "SELECT notification_type FROM web_push_deliveries WHERE id IN ('gate', 'boarding') ORDER BY notification_type",
        )
        .all(),
    ).toEqual([{ notification_type: "BOARDING_STARTED" }, { notification_type: "GO_TO_GATE" }]);
    expect(() => insert.run("invalid", "UNKNOWN")).toThrow(/CHECK constraint failed/);
  });

  it("stellt Fremdschlüssel, Eindeutigkeit und Pending-Index wieder her", () => {
    database.exec(migration);

    const foreignKeys = database
      .prepare("PRAGMA foreign_key_list('web_push_deliveries')")
      .all() as Array<{ table: string }>;
    expect(foreignKeys.map((entry) => entry.table).sort()).toEqual([
      "operation_days",
      "rotations",
      "web_push_subscriptions",
    ]);

    const indexes = database.prepare("PRAGMA index_list('web_push_deliveries')").all() as Array<{
      name: string;
    }>;
    expect(indexes.some((entry) => entry.name === "idx_web_push_deliveries_pending")).toBe(true);

    expect(() =>
      database
        .prepare(`
          INSERT INTO web_push_deliveries
            (id, operation_day_id, subscription_id, rotation_id, notification_type, queued_at)
          VALUES
            ('duplicate', 'event', 'subscription', 'rotation', 'FLIGHT_GROUP_CALLED',
             '2026-07-28T10:02:00.000Z')
        `)
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });
});
