import { describe, expect, it } from "vitest";
import {
  buildTicketGroupRecallCopy,
  TICKET_GROUP_RECALL_DURATION_MS,
  ticketGroupRecallEligibility,
} from "./ticket-group-recall";

describe("ticket group recall", () => {
  it("uses a fixed five-minute duration and public copy without personal data", () => {
    expect(TICKET_GROUP_RECALL_DURATION_MS).toBe(300_000);
    expect(
      buildTicketGroupRecallCopy({
        communicationLabel: "G-SR-0042",
        gateLabel: "Gate 2",
      }),
    ).toEqual({
      fids: "NACHRUF · G-SR-0042 – Bitte sofort zu Gate 2 kommen.",
      publicStatus: "Ihre Gruppe wird erneut aufgerufen. Bitte kommen Sie jetzt sofort zu Gate 2.",
      pushTitle: "Erneuter Aufruf",
      pushBody: "Ihre Gruppe G-SR-0042 wird erneut aufgerufen. Bitte kommen Sie jetzt zu Gate 2.",
    });
  });

  it("allows only queued or missing groups with a gate and no active recall", () => {
    expect(
      ticketGroupRecallEligibility({
        status: "QUEUED",
        gateLabel: "Gate 2",
        activeRecall: false,
      }),
    ).toEqual({ eligible: true, reason: "ELIGIBLE" });
    expect(
      ticketGroupRecallEligibility({
        status: "MISSING",
        gateLabel: "Gate 2",
        activeRecall: false,
      }),
    ).toEqual({ eligible: true, reason: "ELIGIBLE" });
    expect(
      ticketGroupRecallEligibility({
        status: "PRESENT",
        gateLabel: "Gate 2",
        activeRecall: false,
      }),
    ).toEqual({ eligible: false, reason: "STATUS_NOT_ELIGIBLE" });
    expect(
      ticketGroupRecallEligibility({
        status: "QUEUED",
        gateLabel: "",
        activeRecall: false,
      }),
    ).toEqual({ eligible: false, reason: "GATE_REQUIRED" });
    expect(
      ticketGroupRecallEligibility({
        status: "MISSING",
        gateLabel: "Gate 2",
        activeRecall: true,
      }),
    ).toEqual({ eligible: false, reason: "ALREADY_ACTIVE" });
  });
});
