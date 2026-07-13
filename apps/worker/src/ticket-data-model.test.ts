import { describe, expect, it } from "vitest";
import anonymityDecision from "../../../docs/adr/0006-vollstaendig-anonyme-identitaeten.md?raw";
import cashierSource from "../../web/src/App.tsx?raw";
import initialMigration from "../migrations/0001_initial.sql?raw";
import pushMigration from "../migrations/0006_web_push.sql?raw";

describe("anonymous V1 ticket data model", () => {
  it("stores the complete operational ticket record without contact data", () => {
    expect(initialMigration).toMatch(
      /CREATE TABLE ticket_groups \([\s\S]*operation_day_id TEXT NOT NULL[\s\S]*product_id TEXT NOT NULL[\s\S]*queue_sequence INTEGER NOT NULL[\s\S]*standby INTEGER NOT NULL[\s\S]*status TEXT NOT NULL[\s\S]*sold_at TEXT NOT NULL[\s\S]*version INTEGER NOT NULL/,
    );
    expect(initialMigration).toMatch(
      /CREATE TABLE tickets \([\s\S]*ticket_group_id TEXT NOT NULL[\s\S]*public_code_hash TEXT NOT NULL UNIQUE[\s\S]*status TEXT NOT NULL[\s\S]*weight_class TEXT NOT NULL[\s\S]*individual_weight_kg REAL[\s\S]*payment_status TEXT NOT NULL[\s\S]*price_cents INTEGER NOT NULL[\s\S]*created_at TEXT NOT NULL/,
    );
    expect(initialMigration).toMatch(
      /CREATE TABLE rotation_tickets \([\s\S]*rotation_id TEXT NOT NULL[\s\S]*ticket_id TEXT NOT NULL/,
    );
    expect(initialMigration).not.toMatch(/phone|telefon|guest_name|passenger_name/i);
  });

  it("keeps explicit Web Push consent pseudonymously linked to the ticket", () => {
    expect(pushMigration).toMatch(
      /CREATE TABLE web_push_subscriptions \([\s\S]*ticket_id TEXT NOT NULL REFERENCES tickets\(id\)[\s\S]*consented_at TEXT NOT NULL[\s\S]*delete_after TEXT NOT NULL[\s\S]*status TEXT NOT NULL/,
    );
    expect(pushMigration).not.toMatch(/phone|telefon|guest_name|passenger_name/i);
    expect(anonymityDecision).toMatch(
      /Telefonnummern werden weder verpflichtend noch optional erfasst/i,
    );
  });

  it("generates non-sequential public codes from browser cryptography", () => {
    expect(cashierSource).toMatch(
      /function createTicketCode\(\): string \{[\s\S]*crypto\.getRandomValues\(new Uint8Array\(16\)\)/,
    );
  });
});
