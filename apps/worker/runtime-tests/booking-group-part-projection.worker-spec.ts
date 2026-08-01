/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { withBookingGroupPartProjection } from "../src/booking-group-part-projection";
import { loadPendingRotationPushSubscriptions, publicPushPayload } from "../src/web-push";

interface ProjectedPartRow {
  rotation_id: string;
  part_number: number;
  part_count: number;
  passenger_count: number;
}

async function groupParts(ticketGroupId: string): Promise<ProjectedPartRow[]> {
  const result = await env.DB.prepare(
    withBookingGroupPartProjection(
      `SELECT rotation_id, part_number, part_count, passenger_count
         FROM booking_group_parts
        WHERE ticket_group_id = ?1
        ORDER BY part_number`,
    ),
  )
    .bind(ticketGroupId)
    .all<ProjectedPartRow>();
  return result.results;
}

async function ticketPart(ticketId: string): Promise<ProjectedPartRow | null> {
  return env.DB.prepare(
    withBookingGroupPartProjection(
      `SELECT part.rotation_id, part.part_number, part.part_count, part.passenger_count
         FROM tickets ticket
         JOIN rotation_tickets assignment
           ON assignment.ticket_id = ticket.id AND assignment.released_at IS NULL
         JOIN booking_group_parts part
           ON part.ticket_group_id = ticket.ticket_group_id
          AND part.rotation_id = assignment.rotation_id
        WHERE ticket.id = ?1`,
    ),
  )
    .bind(ticketId)
    .first<ProjectedPartRow>();
}

beforeEach(async () => {
  const setupSql = `
    DROP TABLE IF EXISTS web_push_deliveries;
    DROP TABLE IF EXISTS web_push_subscriptions;
    DROP TABLE IF EXISTS rotation_tickets;
    DROP TABLE IF EXISTS rotations;
    DROP TABLE IF EXISTS flight_groups;
    DROP TABLE IF EXISTS tickets;
    DROP TABLE IF EXISTS ticket_groups;
    DROP TABLE IF EXISTS products;
    DROP TABLE IF EXISTS gates;

    CREATE TABLE gates (id TEXT PRIMARY KEY, label TEXT NOT NULL);
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      gate_id TEXT NOT NULL
    );
    CREATE TABLE ticket_groups (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      communication_number INTEGER NOT NULL,
      public_status_code TEXT
    );
    CREATE TABLE tickets (
      id TEXT PRIMARY KEY,
      ticket_group_id TEXT NOT NULL,
      public_code TEXT
    );
    CREATE TABLE flight_groups (
      id TEXT PRIMARY KEY,
      queue_position INTEGER,
      communication_number INTEGER NOT NULL
    );
    CREATE TABLE rotations (
      id TEXT PRIMARY KEY,
      flight_group_id TEXT NOT NULL,
      gate_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE rotation_tickets (
      rotation_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      released_at TEXT,
      PRIMARY KEY (rotation_id, ticket_id)
    );
    CREATE TABLE web_push_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      origin TEXT,
      ticket_id TEXT NOT NULL,
      status TEXT NOT NULL,
      delete_after TEXT NOT NULL
    );
    CREATE TABLE web_push_deliveries (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      rotation_id TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      status TEXT NOT NULL
    );

    INSERT INTO gates VALUES ('gate-1', 'Flight Line 1');
    INSERT INTO products VALUES ('product-pan', 'PAN', 'gate-1');
    INSERT INTO ticket_groups VALUES ('group-a', 'product-pan', 101, 'NPQRSTUVWXYZ2');
    INSERT INTO ticket_groups VALUES ('group-b', 'product-pan', 102, 'ABCDEFGHJKLM');

    INSERT INTO flight_groups VALUES ('flight-released', 0, 90);
    INSERT INTO flight_groups VALUES ('flight-canceled', 0, 91);
    INSERT INTO flight_groups VALUES ('flight-1', 1, 101);
    INSERT INTO flight_groups VALUES ('flight-2', 2, 102);
    INSERT INTO rotations VALUES (
      'rotation-released', 'flight-released', 'gate-1', 'DRAFT', '2026-07-31T09:00:00.000Z'
    );
    INSERT INTO rotations VALUES (
      'rotation-canceled', 'flight-canceled', 'gate-1', 'CANCELED', '2026-07-31T09:05:00.000Z'
    );
    INSERT INTO rotations VALUES (
      'rotation-1', 'flight-1', 'gate-1', 'DRAFT', '2026-07-31T10:00:00.000Z'
    );
    INSERT INTO rotations VALUES (
      'rotation-2', 'flight-2', 'gate-1', 'DRAFT', '2026-07-31T10:05:00.000Z'
    );

    INSERT INTO tickets VALUES ('a-1', 'group-a', 'TICKETAAAAA2');
    INSERT INTO tickets VALUES ('a-2', 'group-a', 'TICKETAAAAA3');
    INSERT INTO tickets VALUES ('a-3', 'group-a', 'TICKETAAAAA4');
    INSERT INTO tickets VALUES ('a-4', 'group-a', 'TICKETAAAAA5');
    INSERT INTO tickets VALUES ('a-5', 'group-a', 'TICKETAAAAA6');
    INSERT INTO tickets VALUES ('a-released', 'group-a', 'TICKETAAAAA7');
    INSERT INTO tickets VALUES ('a-canceled', 'group-a', 'TICKETAAAAA8');
    INSERT INTO tickets VALUES ('b-1', 'group-b', 'TICKETBBBBB2');
    INSERT INTO tickets VALUES ('b-2', 'group-b', 'TICKETBBBBB3');

    INSERT INTO rotation_tickets VALUES ('rotation-1', 'a-1', NULL);
    INSERT INTO rotation_tickets VALUES ('rotation-1', 'a-2', NULL);
    INSERT INTO rotation_tickets VALUES ('rotation-1', 'a-3', NULL);
    INSERT INTO rotation_tickets VALUES ('rotation-2', 'a-4', NULL);
    INSERT INTO rotation_tickets VALUES ('rotation-2', 'a-5', NULL);
    INSERT INTO rotation_tickets VALUES (
      'rotation-released', 'a-released', '2026-07-31T09:10:00.000Z'
    );
    INSERT INTO rotation_tickets VALUES ('rotation-canceled', 'a-canceled', NULL);
    INSERT INTO rotation_tickets VALUES ('rotation-2', 'b-1', NULL);
    INSERT INTO rotation_tickets VALUES ('rotation-2', 'b-2', NULL);

    INSERT INTO web_push_subscriptions VALUES (
      'subscription-a', 'https://fcm.googleapis.com/fcm/send/a', 'key-a', 'auth-a',
      'GROUP', 'https://status.example', 'a-1', 'ACTIVE', '2026-08-10T00:00:00.000Z'
    );
    INSERT INTO web_push_subscriptions VALUES (
      'subscription-b', 'https://fcm.googleapis.com/fcm/send/b', 'key-b', 'auth-b',
      'GROUP', 'https://status.example', 'b-1', 'ACTIVE', '2026-08-10T00:00:00.000Z'
    );
    INSERT INTO web_push_deliveries VALUES (
      'delivery-a', 'subscription-a', 'rotation-2', 'GO_TO_GATE', 'PENDING'
    );
    INSERT INTO web_push_deliveries VALUES (
      'delivery-b', 'subscription-b', 'rotation-2', 'GO_TO_GATE', 'PENDING'
    );
  `;
  for (const statement of setupSql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await env.DB.prepare(statement).run();
  }
});

describe("V18-GRP-010 canonical booking group part projection", () => {
  it("projects a five-person split as one 3-person and one 2-person rotation", async () => {
    const parts = await groupParts("group-a");

    expect(parts).toEqual([
      { rotation_id: "rotation-1", part_number: 1, part_count: 2, passenger_count: 3 },
      { rotation_id: "rotation-2", part_number: 2, part_count: 2, passenger_count: 2 },
    ]);
  });

  it("matches a legacy ticket from the second part to the group projection", async () => {
    const parts = await groupParts("group-a");
    const legacyTicketPart = await ticketPart("a-4");

    expect(legacyTicketPart).toEqual(parts[1]);
  });

  it("counts each rotation once and excludes released assignments and canceled rotations", async () => {
    const parts = await groupParts("group-a");

    expect(parts).toHaveLength(2);
    expect(parts.map((part) => part.rotation_id)).toEqual(["rotation-1", "rotation-2"]);
    expect(parts.reduce((sum, part) => sum + part.passenger_count, 0)).toBe(5);
  });

  it("projects the triggering rotation separately for each subscribed booking group", async () => {
    const subscriptions = await loadPendingRotationPushSubscriptions(
      env.DB,
      "rotation-2",
      "GO_TO_GATE",
      "2026-08-01T00:00:00.000Z",
    );

    expect(
      subscriptions.map((subscription) => ({
        id: subscription.id,
        partNumber: subscription.part_number,
        partCount: subscription.part_count,
        passengerCount: subscription.passenger_count,
      })),
    ).toEqual([
      { id: "subscription-a", partNumber: 2, partCount: 2, passengerCount: 2 },
      { id: "subscription-b", partNumber: 1, partCount: 1, passengerCount: 2 },
    ]);

    const splitPayload = JSON.parse(
      publicPushPayload({
        notificationType: "GO_TO_GATE",
        targetPath: "/gruppe/NPQRSTUVWXYZ2",
        origin: null,
        gateLabel: "Flight Line 1",
        bookingGroupLabel: "G-PAN-0101",
        bookingGroupPart: { partNumber: 2, partCount: 2, passengerCount: 2 },
      }),
    );
    const singlePayload = JSON.parse(
      publicPushPayload({
        notificationType: "GO_TO_GATE",
        targetPath: "/gruppe/ABCDEFGHJKLM",
        origin: null,
        gateLabel: "Flight Line 1",
        bookingGroupLabel: "G-PAN-0102",
        bookingGroupPart: { partNumber: 1, partCount: 1, passengerCount: 2 },
      }),
    );

    expect(splitPayload.title).toBe("Teilflug 2/2 · Bitte zum Gate");
    expect(splitPayload.body).toMatch(/^Teilflug 2 von 2 der Gruppe G-PAN-0101: /);
    expect(singlePayload.title).toBe("Bitte zum Gate");
    expect(singlePayload.body).not.toContain("Teilflug");
    expect(JSON.stringify([splitPayload, singlePayload])).not.toMatch(
      /rotation-|flight-|aircraft|registration|guest|phone/i,
    );
  });
});
