// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import migration from "../migrations/0051_web_push_origin.sql?raw";

describe("Web-Push-Ursprungsmigration 0051", () => {
  it("ergänzt den Ursprung, ohne Bestandsabonnements zu entwerten", () => {
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
      .prepare("SELECT status, origin FROM web_push_subscriptions WHERE id = ?")
      .get("synthetic-subscription") as { status: string; origin: string | null };
    expect(migrated.status).toBe("ACTIVE");
    expect(migrated.origin).toBeNull();
    database.close();
  });
});
