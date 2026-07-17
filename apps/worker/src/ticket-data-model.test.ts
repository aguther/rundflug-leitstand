import { describe, expect, it } from "vitest";
import anonymityDecision from "../../../docs/adr/0006-vollstaendig-anonyme-identitaeten.md?raw";
import cashierViewSource from "../../web/src/cashier-view.tsx?raw";
import operationWorkspaceSource from "../../web/src/operation-workspace.tsx?raw";
import initialMigration from "../migrations/0001_initial.sql?raw";
import pushMigration from "../migrations/0006_web_push.sql?raw";
import rotationMigration from "../migrations/0026_rotation_gate_and_note.sql?raw";
import coordinator from "./event-coordinator.ts?raw";
import worker from "./index.ts?raw";

const cashierSource = `${cashierViewSource}\n${operationWorkspaceSource}`;

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

  it("normalizes the complete stable flight-group and queue model", () => {
    expect(initialMigration).toMatch(
      /CREATE TABLE flight_groups \([\s\S]*operation_day_id TEXT NOT NULL[\s\S]*resource_group_id TEXT NOT NULL[\s\S]*communication_number INTEGER NOT NULL[\s\S]*status TEXT NOT NULL[\s\S]*UNIQUE \(operation_day_id, resource_group_id, communication_number\)/,
    );
    expect(initialMigration).toMatch(
      /CREATE TABLE rotations \([\s\S]*flight_group_id TEXT NOT NULL REFERENCES flight_groups\(id\)/,
    );
    expect(initialMigration).toMatch(
      /CREATE TABLE rotation_tickets \([\s\S]*rotation_id TEXT NOT NULL[\s\S]*ticket_id TEXT NOT NULL/,
    );
    expect(rotationMigration).toContain("ALTER TABLE rotations ADD COLUMN gate_id");
    expect(coordinator).toMatch(/MAX\(tg\.queue_sequence\)[\s\S]*p\.resource_group_id = \?2/);
  });

  it("uses the frozen rotation gate in protected and public slot projections", () => {
    expect(worker).toContain("COALESCE(r.gate_id, MIN(p.gate_id), '') AS gate_id");
    expect(worker.match(/g\.id = COALESCE\(r\.gate_id, p\.gate_id\)/g)).toHaveLength(2);
    expect(worker).toContain("communicationNumber: row.communication_number");
    expect(worker).toContain("queuePosition:");
    expect(worker).toContain("prediction_lower_minutes");
    expect(worker).toContain("prediction_upper_minutes");
  });
});
