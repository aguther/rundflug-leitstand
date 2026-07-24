// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import migration from "../migrations/0043_web_push_target_kind.sql?raw";

describe("Web-Push-Zieltyp-Migration 0043", () => {
  it("führt bestehende Abonnements auf den kanonischen Gruppenstatus zurück", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE web_push_subscriptions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        delete_after TEXT NOT NULL
      );
      INSERT INTO web_push_subscriptions (id, status, delete_after)
      VALUES ('synthetic-subscription', 'ACTIVE', '2026-07-30T18:00:00.000Z');
    `);
    database.exec(migration);
    const migrated = database
      .prepare("SELECT target_kind FROM web_push_subscriptions WHERE id = ?")
      .get("synthetic-subscription") as { target_kind: string };
    expect(migrated.target_kind).toBe("GROUP");
    expect(() =>
      database.exec(`
        INSERT INTO web_push_subscriptions (id, status, delete_after, target_kind)
        VALUES ('invalid-target', 'ACTIVE', '2026-07-30T18:00:00.000Z', 'LOGIN');
      `),
    ).toThrow();
    database.close();
  });
});
