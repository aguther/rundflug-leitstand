import { describe, expect, it } from "vitest";
import cashier from "../../web/src/cashier-view.tsx?raw";
import publicStatusContent from "../../web/src/features/public-status/PublicStatusContent.tsx?raw";
import groupStatus from "../../web/src/group-status-view.tsx?raw";
import { createMigratedTestDatabase, type SqliteRow } from "../test-support/migrated-database";
import webPush from "./web-push.ts?raw";

describe("V1.8 public group ticket", () => {
  it("stores protected group codes without personal identity fields", () => {
    const database = createMigratedTestDatabase();
    const columns = database.prepare("PRAGMA table_info(ticket_groups)").all();
    const indexes = database.prepare("PRAGMA index_list(ticket_groups)").all();

    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "public_status_code_hash" }),
        expect.objectContaining({ name: "public_status_code" }),
      ]),
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "idx_ticket_groups_public_status_code_hash", unique: 1 }),
      ]),
    );
    expect(columns.map((column: SqliteRow) => String(column.name))).not.toEqual(
      expect.arrayContaining(["phone", "guest_name", "passenger_name"]),
    );
    database.close();
  });

  it("creates a distinct group code and prints exactly one group QR document", () => {
    expect(cashier).toContain("ticketCount: size");
    expect(cashier).not.toContain("publicGroupCode");
    expect(cashier).not.toContain("publicTicketCodes");
    expect(cashier).toContain("/gruppe/");
    expect(cashier).toContain("images.length !== 1");
    expect(cashier).toContain("Ticket drucken");
    expect(cashier).not.toContain(["/ticket/$", "{encodeURIComponent(ticket.code)}"].join(""));
  });

  it("aggregates split parts without publishing an internal F identifier", () => {
    expect(publicStatusContent).toContain("formatBookingGroupPart(bookingGroupPart)");
    expect(groupStatus).not.toContain("communicationLabel");
    expect(groupStatus).not.toContain("flightGroup");
  });

  it("keeps legacy links and follows every current part for group push", () => {
    expect(webPush).toContain("group_ticket.ticket_group_id = w.ticket_group_id");
    expect(webPush).toContain("group_rt.rotation_id = ?1");
  });

  it("migrates existing subscriptions to canonical group targets", () => {
    const database = createMigratedTestDatabase();
    const targetKind = database
      .prepare("PRAGMA table_info(web_push_subscriptions)")
      .all()
      .find((column: SqliteRow) => column.name === "target_kind") as
      | { dflt_value: string; notnull: number }
      | undefined;

    expect(targetKind).toMatchObject({ dflt_value: "'GROUP'", notnull: 1 });
    expect(webPush).toContain("publicPushTargetPath");
    database.close();
  });
});
