import { describe, expect, it } from "vitest";
import cashier from "../../web/src/cashier-view.tsx?raw";
import groupStatus from "../../web/src/group-status-view.tsx?raw";
import migration from "../migrations/0042_group_status_codes_and_push.sql?raw";
import coordinator from "./event-coordinator.ts?raw";
import worker from "./index.ts?raw";
import webPush from "./web-push.ts?raw";

describe("V1.8 public group ticket", () => {
  it("backfills one protected group code from the oldest legacy ticket", () => {
    expect(migration).toContain("ALTER TABLE ticket_groups ADD COLUMN public_status_code_hash");
    expect(migration).toContain("ALTER TABLE ticket_groups ADD COLUMN public_status_code");
    expect(migration).toMatch(
      /SELECT t\.public_code_hash[\s\S]*ORDER BY t\.created_at, t\.id[\s\S]*LIMIT 1/,
    );
    expect(migration).toContain("idx_ticket_groups_public_status_code_hash");
    expect(migration).not.toMatch(/phone|guest_name|passenger_name/i);
  });

  it("creates a distinct group code and prints exactly one group QR document", () => {
    expect(cashier).toContain("const groupCode = createTicketCode()");
    expect(cashier).toContain("publicGroupCode: groupCode");
    expect(cashier).toContain("/gruppe/");
    expect(cashier).toContain("images.length !== 1");
    expect(cashier).toContain("Ticket drucken");
    expect(cashier).not.toContain(["/ticket/$", "{encodeURIComponent(ticket.code)}"].join(""));
    expect(coordinator).toContain("public_status_code_hash, public_status_code");
    expect(worker).toContain("groupSize: first.group_size");
    expect(worker).not.toContain("tickets: rows.results.map");
  });

  it("aggregates split parts without publishing an internal F identifier", () => {
    expect(worker).toContain('app.get("/api/public/groups/:groupCode"');
    expect(worker).toContain("partNumber: index + 1");
    expect(worker).toContain("passengerCount: rotation.passenger_count");
    expect(groupStatus).toContain(
      ["`Teilflug $", "{part.partNumber} von $", "{part.partCount}`"].join(""),
    );
    expect(groupStatus).not.toContain("communicationLabel");
    expect(groupStatus).not.toContain("flightGroup");
  });

  it("keeps legacy links and follows every current part for group push", () => {
    expect(worker).toContain('app.get("/api/public/tickets/:ticketCode"');
    expect(worker).toContain('app.post("/api/public/groups/:groupCode/push-subscriptions"');
    expect(webPush).toContain("group_ticket.ticket_group_id = w.ticket_group_id");
    expect(webPush).toContain("group_rt.rotation_id = ?1");
  });

  it("does not put the public group code into audit or outbox payloads", () => {
    expect(coordinator).not.toContain("publicGroupCode: normalizedGroupCode");
    expect(coordinator).not.toContain("publicStatusCode: normalizedGroupCode");
    expect(worker).not.toMatch(/console\.(?:log|info|warn)\([^)]*(?:groupCode|ticketCode)/);
  });
});
