import { describe, expect, it } from "vitest";
import {
  activeTicketGroupRecallProjection,
  predictedBoardingWindow,
} from "./public-status-projection";

describe("public status projections", () => {
  it("omits incomplete ticket group recalls", () => {
    expect(
      activeTicketGroupRecallProjection({
        recall_id: "recall-1",
        recall_sequence: null,
        recall_started_at: "2026-08-09T08:00:00.000Z",
        recall_expires_at: "2026-08-09T08:05:00.000Z",
        product_code: "PAN20",
        communication_number: 8021,
        gate_label: "Gate 2",
      }),
    ).toBeNull();
  });

  it("projects an active recall with the public communication copy", () => {
    expect(
      activeTicketGroupRecallProjection({
        recall_id: "recall-1",
        recall_sequence: 3,
        recall_started_at: "2026-08-09T08:00:00.000Z",
        recall_expires_at: "2026-08-09T08:05:00.000Z",
        product_code: "PAN20",
        communication_number: 8021,
        gate_label: "Gate 2",
      }),
    ).toEqual({
      id: "recall-1",
      sequence: 3,
      startedAt: "2026-08-09T08:00:00.000Z",
      expiresAt: "2026-08-09T08:05:00.000Z",
      fidsMessage: "NACHRUF · G-PAN20-8021 – Bitte sofort zu Gate 2 kommen.",
      publicMessage: "Ihre Gruppe wird erneut aufgerufen. Bitte kommen Sie jetzt sofort zu Gate 2.",
    });
  });

  it.each([
    { status: "CALLED" as const, quality: "STABLE" as const },
    { status: "DRAFT" as const, quality: "UNCERTAIN" as const },
  ])("omits the boarding window for $status and $quality", ({ status, quality }) => {
    expect(
      predictedBoardingWindow({
        status,
        quality,
        predictedBoardingAt: "2026-08-09T08:30:00.000Z",
        lowerMinutes: 20,
        upperMinutes: 40,
        referenceAt: "2026-08-09T08:00:00.000Z",
      }),
    ).toEqual({ lowerAt: null, upperAt: null });
  });

  it("builds the boarding window from the reference when no center is stored", () => {
    expect(
      predictedBoardingWindow({
        status: "DRAFT",
        quality: "CHANGING",
        predictedBoardingAt: null,
        lowerMinutes: 20,
        upperMinutes: 40,
        referenceAt: "2026-08-09T08:00:00.000Z",
      }),
    ).toEqual({
      lowerAt: "2026-08-09T08:20:00.000Z",
      upperAt: "2026-08-09T08:40:00.000Z",
    });
  });

  it("centers the boarding window around the stored prediction", () => {
    expect(
      predictedBoardingWindow({
        status: "DRAFT",
        quality: "STABLE",
        predictedBoardingAt: "2026-08-09T09:00:00.000Z",
        lowerMinutes: 15,
        upperMinutes: 45,
        referenceAt: "2026-08-09T08:00:00.000Z",
      }),
    ).toEqual({
      lowerAt: "2026-08-09T08:45:00.000Z",
      upperAt: "2026-08-09T09:15:00.000Z",
    });
  });
});
