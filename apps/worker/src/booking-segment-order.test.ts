// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import migration from "../migrations/0068_booking_segment_order.sql?raw";

describe("booking segment order migration", () => {
  it("backfills the persisted sale order and enforces positive values", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE rotations (
        id TEXT PRIMARY KEY,
        operation_day_id TEXT NOT NULL
      ) STRICT;
      CREATE TABLE operational_events (
        id TEXT PRIMARY KEY,
        operation_day_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      ) STRICT;
      INSERT INTO rotations VALUES
        ('rotation-first', 'event-a'),
        ('rotation-second', 'event-a'),
        ('rotation-without-sale', 'event-a');
      INSERT INTO operational_events VALUES (
        'sale-a',
        'event-a',
        'TICKET_GROUP_SOLD',
        '2026-08-05T12:00:00.000Z',
        '{"rotationIds":["rotation-first","rotation-second"]}'
      );
    `);

    database.exec(migration);

    expect(
      database
        .prepare("SELECT booking_segment_order AS value FROM rotations WHERE id = ?")
        .get("rotation-first"),
    ).toEqual({ value: 1 });
    expect(
      database
        .prepare("SELECT booking_segment_order AS value FROM rotations WHERE id = ?")
        .get("rotation-second"),
    ).toEqual({ value: 2 });
    expect(
      database
        .prepare("SELECT booking_segment_order AS value FROM rotations WHERE id = ?")
        .get("rotation-without-sale"),
    ).toEqual({ value: 1 });
    expect(() =>
      database
        .prepare("UPDATE rotations SET booking_segment_order = 0 WHERE id = ?")
        .run("rotation-first"),
    ).toThrow(/CHECK constraint failed/);
  });
});
