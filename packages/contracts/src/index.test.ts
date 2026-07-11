import { describe, expect, it } from "vitest";
import { commandEnvelopeSchema, publicBoardSchema, publicTicketStatusSchema } from "./index";

describe("commandEnvelopeSchema", () => {
  it("validates auditable product sale controls", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "550e8400-e29b-41d4-a716-446655440000",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 2,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "CONFIGURE_PRODUCT_SALES",
      payload: {
        productId: "synthetic-product",
        saleEnabled: false,
        saleClosesAt: "2026-07-11T18:00:00.000Z",
        warningThreshold: 12,
        criticalThreshold: 4,
        reason: "Kapazität prüfen",
        adminPin: "0000",
      },
    });
    expect(parsed.type).toBe("CONFIGURE_PRODUCT_SALES");
  });

  it("accepts only hashed credentials for device pairing", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "550e8400-e29b-41d4-a716-446655440001",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 2,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "PAIR_DEVICE",
      payload: {
        pairedDeviceId: "550e8400-e29b-41d4-a716-446655440002",
        label: "Kasse 2",
        role: "CASHIER",
        credentialHash: "a".repeat(64),
        adminPin: "0000",
      },
    });
    expect(parsed.type).toBe("PAIR_DEVICE");
    expect(JSON.stringify(parsed)).not.toContain("device-token");
  });

  it("validates organizational fleet controls without safety semantics", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "550e8400-e29b-41d4-a716-446655440010",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-lead",
      expectedVersion: 4,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "SET_AIRCRAFT_OPERATIONAL_STATE",
      payload: {
        aircraftId: "synthetic-aircraft",
        state: "PAUSED",
        reason: "Organisatorische Pause",
        expectedReviewAt: "2026-07-11T12:30:00.000Z",
      },
    });
    expect(parsed.type).toBe("SET_AIRCRAFT_OPERATIONAL_STATE");
    expect(JSON.stringify(parsed)).not.toMatch(/safe|freigabe/i);
  });

  it("accepts anonymous pilot codes and no pilot name", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "550e8400-e29b-41d4-a716-446655440011",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 5,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "UPSERT_PILOT",
      payload: {
        pilotId: "550e8400-e29b-41d4-a716-446655440012",
        operationalCode: "P-01",
        active: true,
        reason: "Dienstplan aktualisiert",
        adminPin: "0000",
      },
    });
    expect(parsed.type).toBe("UPSERT_PILOT");
    expect(JSON.stringify(parsed)).not.toContain("pilotName");
  });

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

  it("requires a concrete aircraft confirmation for NEXT", () => {
    expect(() =>
      commandEnvelopeSchema.parse({
        commandId: "00e971df-23d5-4d28-9107-92b447416284",
        eventId: "demo-2026",
        deviceId: "flight-line-tablet-1",
        expectedVersion: 4,
        issuedAt: "2026-07-11T12:00:00.000Z",
        type: "CALL_NEXT",
        payload: { rotationId: "rotation-1" },
      }),
    ).toThrow();
  });

  it("keeps public DTOs free of aircraft and guest identity", () => {
    const status = publicTicketStatusSchema.parse({
      productName: "Panorama",
      communicationNumber: 101,
      status: "WAITING",
      queuePosition: 1,
      waitLowerMinutes: 0,
      waitUpperMinutes: 30,
      predictionQuality: "CHANGING",
      message: "Bitte Status prüfen.",
      updatedAt: "2026-07-11T12:00:00.000Z",
    });
    const board = publicBoardSchema.parse({
      eventName: "Demo",
      emergencyMode: false,
      updatedAt: "2026-07-11T12:00:00.000Z",
      groups: [
        {
          productName: "Panorama",
          communicationNumber: 101,
          status: "WAITING",
          waitLowerMinutes: 0,
          waitUpperMinutes: 30,
        },
      ],
    });
    expect("aircraftRegistration" in status).toBe(false);
    expect("guestName" in board).toBe(false);
  });

  it("requires an administrator PIN in the clear-emergency contract", () => {
    expect(() =>
      commandEnvelopeSchema.parse({
        commandId: "00e971df-23d5-4d28-9107-92b447416285",
        eventId: "demo-2026",
        deviceId: "technical-scaffold",
        expectedVersion: 9,
        issuedAt: "2026-07-11T12:00:00.000Z",
        type: "CLEAR_EMERGENCY",
        payload: { reason: "Übung beendet" },
      }),
    ).toThrow();
  });
});
