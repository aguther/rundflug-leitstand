import { describe, expect, it } from "vitest";
import { commandEnvelopeSchema } from "./index";

describe("commandEnvelopeSchema", () => {
  it("accepts the technical scaffold command", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "4f6ef267-f2c3-4c20-95fe-283e6f4ecab1",
      eventId: "demo-2026",
      deviceId: "technical-scaffold",
      expectedVersion: 0,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "SET_OPERATIONAL_NOTE",
      payload: { note: "Technischer Test" },
    });
    expect(parsed.type).toBe("SET_OPERATIONAL_NOTE");
  });

  it("rejects an invalid idempotency identifier", () => {
    expect(() =>
      commandEnvelopeSchema.parse({
        commandId: "not-a-uuid",
        eventId: "demo-2026",
        deviceId: "technical-scaffold",
        expectedVersion: 0,
        issuedAt: "2026-07-11T12:00:00.000Z",
        type: "SET_OPERATIONAL_NOTE",
        payload: { note: "Technischer Test" },
      }),
    ).toThrow();
  });

  it("accepts a phone-free ticket group sale", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416283",
      eventId: "demo-2026",
      deviceId: "cashier-tablet-1",
      expectedVersion: 3,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "SELL_TICKET_GROUP",
      payload: {
        productId: "panorama-20",
        publicTicketCodes: ["ABCDE2345678"],
        paymentStatus: "PAID",
        paymentMethod: "CASH",
      },
    });
    expect(parsed.type).toBe("SELL_TICKET_GROUP");
    expect("phoneNumber" in parsed.payload).toBe(false);
  });
});
