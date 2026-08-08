import { describe, expect, it } from "vitest";
import contracts from "../../../packages/contracts/src/index.ts?raw";
import domain from "../../../packages/domain/src/index.ts?raw";
import publicStatus from "../../web/src/features/public-status/PublicStatusContent.tsx?raw";
import fids from "../../web/src/fids-display.tsx?raw";
import migration from "../migrations/0055_ticket_group_recalls.sql?raw";
import worker from "./index.ts?raw";
import push from "./web-push.ts?raw";

describe("V1.11 aktiver Gruppennachruf", () => {
  it("trennt den öffentlichen Nachruf vom bisherigen Queue-Kommando und berechtigt die drei Rollen", () => {
    expect(contracts).toContain('type: z.literal("START_TICKET_GROUP_RECALL")');
    expect(contracts).toContain('type: z.literal("CLEAR_TICKET_GROUP_RECALL")');
    expect(contracts).toContain('type: z.literal("RESTORE_TICKET_GROUP_TO_QUEUE")');
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
    const inlineProjections =
      worker.match(/activeRecall: activeTicketGroupRecallProjection/g)?.length ?? 0;
    const reusedProjections =
      worker.match(/const activeRecall = activeTicketGroupRecallProjection/g)?.length ?? 0;
    expect(inlineProjections + reusedProjections).toBeGreaterThanOrEqual(4);
    expect(worker).toContain("recall.ended_at IS NULL");
    expect(worker).toContain("recall.expires_at > ?2");
    expect(fids).toContain("group.activeRecall");
    expect(fids).toContain("<span>NACHRUF</span>");
    expect(fids).toContain("fids-status-cell");
    expect(publicStatus).toContain("PublicRecallNotice");
    expect(publicStatus).toContain("recall.publicMessage");
  });

  it("nimmt keine Namen oder frei formulierten öffentlichen Texte in den Vorgang auf", () => {
    expect(migration).not.toMatch(/guest_name|passenger_name|phone_number/i);
    expect(contracts).not.toMatch(/START_TICKET_GROUP_RECALL[\s\S]{0,300}(message|text):/i);
  });
});
