import { commandEnvelopeSchema } from "@rundflug/contracts/operations-dispatch";
import { describe, expect, it } from "vitest";
import domain from "../../../packages/domain/src/index.ts?raw";
import publicStatus from "../../web/src/features/public-status/PublicStatusContent.tsx?raw";
import fids from "../../web/src/fids-display.tsx?raw";
import migration from "../migrations/0055_ticket_group_recalls.sql?raw";
import push from "./web-push.ts?raw";

describe("V1.11 aktiver Gruppennachruf", () => {
  it("trennt den öffentlichen Nachruf vom bisherigen Queue-Kommando und berechtigt die drei Rollen", () => {
    const commandBase = {
      commandId: "836fa884-8c1e-48ab-9a9e-a4e61ac889b6",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-line",
      expectedVersion: 11,
      issuedAt: "2026-08-10T08:00:00.000Z",
    };
    const commands = [
      commandEnvelopeSchema.parse({
        ...commandBase,
        type: "START_TICKET_GROUP_RECALL",
        payload: { ticketGroupId: "synthetic-ticket-group" },
      }),
      commandEnvelopeSchema.parse({
        ...commandBase,
        type: "CLEAR_TICKET_GROUP_RECALL",
        payload: {
          ticketGroupId: "synthetic-ticket-group",
          recallId: "c3321176-e877-48fe-b90e-33cd944bcd8d",
        },
      }),
      commandEnvelopeSchema.parse({
        ...commandBase,
        type: "RESTORE_TICKET_GROUP_TO_QUEUE",
        payload: { ticketGroupId: "synthetic-ticket-group" },
      }),
    ];

    expect(commands.map((command) => command.type)).toEqual([
      "START_TICKET_GROUP_RECALL",
      "CLEAR_TICKET_GROUP_RECALL",
      "RESTORE_TICKET_GROUP_TO_QUEUE",
    ]);
    expect(domain).toContain(
      'START_TICKET_GROUP_RECALL: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]',
    );
    expect(domain).toContain(
      'CLEAR_TICKET_GROUP_RECALL: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]',
    );
    expect(domain).toContain(
      'RESTORE_TICKET_GROUP_TO_QUEUE: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]',
    );
  });

  it("persistiert Sequenz, Zeitraum und höchstens einen aktiven Vorgang je Gruppe", () => {
    expect(migration).toContain("CREATE TABLE ticket_group_recalls");
    expect(migration).toContain("UNIQUE(ticket_group_id, sequence)");
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX uq_ticket_group_recalls_active[\s\S]*WHERE ended_at IS NULL/,
    );
    expect(migration).toContain("CHECK (expires_at > started_at)");
  });

  it("dedupliziert Push pro Nachruf-ID und adressiert ausschließlich die konkrete Buchungsgruppe", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX uq_web_push_deliveries_recall[\s\S]*subscription_id, ticket_group_recall_id/,
    );
    expect(push).toContain("subscription.ticket_group_id = recall.ticket_group_id");
    expect(push).toContain("delivery.ticket_group_recall_id = ?1");
    expect(push).not.toContain("recall.rotation_id");
    expect(push).toContain('deliverStoredPushSubscriptions(env, "TICKET_GROUP_RECALL"');
  });

  it("projiziert den aktiven Vorgang in Leitstand, Ticket, Gruppe und FIDS ohne Normalstatus zu ersetzen", () => {
    expect(fids).toContain("group.activeRecall");
    expect(fids).toContain("<span>NACHRUF</span>");
    expect(fids).toContain("fids-status-cell");
    expect(publicStatus).toContain("PublicRecallNotice");
    expect(publicStatus).toContain("recall.publicMessage");
  });

  it("nimmt keine Namen oder frei formulierten öffentlichen Texte in den Vorgang auf", () => {
    expect(migration).not.toMatch(/guest_name|passenger_name|phone_number/i);
    const command = commandEnvelopeSchema.parse({
      commandId: "d35d70d4-c302-431a-89b8-83b7cad9d198",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-line",
      expectedVersion: 11,
      issuedAt: "2026-08-10T08:00:00.000Z",
      type: "START_TICKET_GROUP_RECALL",
      payload: {
        ticketGroupId: "synthetic-ticket-group",
        message: "This free text must not cross the contract boundary",
        text: "This field must be removed as well",
      },
    });

    expect(command.payload).toEqual({ ticketGroupId: "synthetic-ticket-group" });
  });
});
