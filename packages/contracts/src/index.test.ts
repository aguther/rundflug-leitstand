import { describe, expect, it } from "vitest";
import {
  cloneEventRequestSchema,
  commandEnvelopeSchema,
  publicBoardSchema,
  publicTicketStatusSchema,
  ticketSearchResponseSchema,
} from "./index";

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

  it("validates the organizational refuel reminder threshold", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "550e8400-e29b-41d4-a716-446655440013",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 6,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD",
      payload: {
        aircraftId: "synthetic-aircraft",
        reminderThreshold: 6,
        reason: "Organisatorische Erinnerung",
        adminPin: "0000",
      },
    });
    expect(parsed.type).toBe("CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD");
  });

  it("allows a resource notice to be cleared without safety semantics", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "550e8400-e29b-41d4-a716-446655440014",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-lead",
      expectedVersion: 7,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "SET_RESOURCE_GROUP_NOTICE",
      payload: { resourceGroupId: "synthetic-group", note: "" },
    });
    expect(parsed.type).toBe("SET_RESOURCE_GROUP_NOTICE");
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
        publicTicketCodes: ["ABCDE2345678", "FGHJK2345678"],
        ticketDetails: [
          { weightClass: "CHILD", individualWeightKg: null },
          { weightClass: "INDIVIDUAL", individualWeightKg: 72 },
        ],
        paymentStatus: "PAID",
        paymentMethod: "CASH",
      },
    });
    expect(parsed.type).toBe("SELL_TICKET_GROUP");
    if (parsed.type !== "SELL_TICKET_GROUP") throw new Error("Verkaufskommando erwartet.");
    expect("phoneNumber" in parsed.payload).toBe(false);
    expect(parsed.payload.ticketDetails?.[1]?.individualWeightKg).toBe(72);
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

  it("requires both aircraft and anonymous pilot confirmation for NEXT", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416294",
      eventId: "demo-2026",
      deviceId: "flight-line-tablet-1",
      expectedVersion: 4,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "CALL_NEXT",
      payload: { rotationId: "rotation-1", aircraftId: "aircraft-1", pilotId: "pilot-code-1" },
    });
    expect(parsed.type).toBe("CALL_NEXT");
  });

  it("validates an anonymous pilot pause with optional review time", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416295",
      eventId: "demo-2026",
      deviceId: "flight-line-lead-1",
      expectedVersion: 5,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "SET_PILOT_PAUSE",
      payload: {
        pilotId: "pilot-code-1",
        paused: true,
        reason: "Organisatorische Pause",
        expectedReviewAt: "2026-07-11T12:30:00.000Z",
      },
    });
    expect(parsed.type).toBe("SET_PILOT_PAUSE");
  });

  it("keeps public DTOs free of aircraft and guest identity", () => {
    const status = publicTicketStatusSchema.parse({
      productName: "Panorama",
      productCode: "PAN",
      publicDescription: "Panoramaflug",
      gateLabel: "Flight Line 1",
      communicationNumber: 101,
      status: "WAITING",
      queuePosition: 1,
      waitLowerMinutes: 0,
      waitUpperMinutes: 30,
      predictionQuality: "CHANGING",
      message: "Bitte Status prüfen.",
      operationalNotice: "",
      updatedAt: "2026-07-11T12:00:00.000Z",
    });
    const board = publicBoardSchema.parse({
      eventName: "Demo",
      emergencyMode: false,
      operationalInterrupted: false,
      operationalNotice: "",
      updatedAt: "2026-07-11T12:00:00.000Z",
      groups: [
        {
          productName: "Panorama",
          productCode: "PAN",
          gateLabel: "Flight Line 1",
          communicationNumber: 101,
          status: "WAITING",
          waitLowerMinutes: 0,
          waitUpperMinutes: 30,
          operationalNotice: "",
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

  it("accepts an anonymous ticket attendance toggle", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416286",
      eventId: "demo-2026",
      deviceId: "flight-line-tablet-1",
      expectedVersion: 9,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "SET_TICKET_ATTENDANCE",
      payload: { ticketId: "internal-ticket-id", checkedIn: true },
    });
    expect(parsed.type).toBe("SET_TICKET_ATTENDANCE");
  });

  it("validates configurable event parameters without guest data", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416287",
      eventId: "demo-2026",
      deviceId: "technical-scaffold",
      expectedVersion: 12,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "CONFIGURE_EVENT_PARAMETERS",
      payload: {
        saleOpensAt: "2026-07-11T07:00:00.000Z",
        operationsEndAt: "2026-07-11T18:00:00.000Z",
        noShowAfterMinutes: 10,
        notificationLeadMinutes: 15,
        childReferenceWeightKg: 35,
        normalReferenceWeightKg: 80,
        heavyReferenceWeightKg: 110,
        plannedBoardingMinutes: 8,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 3,
        reason: "Tagesparameter geprüft",
        adminPin: "0000",
      },
    });
    expect(parsed.type).toBe("CONFIGURE_EVENT_PARAMETERS");
    expect("guestName" in parsed.payload).toBe(false);
  });

  it("validates anonymous product master data", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416288",
      eventId: "demo-2026",
      deviceId: "technical-scaffold",
      expectedVersion: 13,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "UPSERT_PRODUCT",
      payload: {
        productId: "panorama-20",
        resourceGroupId: "rg-panorama",
        gateId: "demo-2026-gate-main",
        name: "20 Min. Panorama",
        code: "PAN20",
        publicDescription: "Panoramaflug",
        priceCents: 4500,
        referenceCapacity: 4,
        referenceDurationMinutes: 20,
        childCompanionRequired: true,
        weightClasses: ["CHILD", "NORMAL", "HEAVY"],
        sortOrder: 10,
        reason: "Stammdatenpflege",
        adminPin: "0000",
      },
    });
    expect(parsed.type).toBe("UPSERT_PRODUCT");
    expect("guestName" in parsed.payload).toBe(false);
  });

  it("validates a reasoned aircraft resource assignment", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416289",
      eventId: "demo-2026",
      deviceId: "technical-scaffold",
      expectedVersion: 14,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "ASSIGN_AIRCRAFT_RESOURCE_GROUP",
      payload: {
        aircraftId: "aircraft-a",
        resourceGroupId: "rg-panorama",
        effectiveAt: "2026-07-11T12:00:00.000Z",
        reason: "Operative Neuordnung",
        adminPin: "0000",
      },
    });
    expect(parsed.type).toBe("ASSIGN_AIRCRAFT_RESOURCE_GROUP");
  });

  it("validates an anonymous event template copy", () => {
    const parsed = cloneEventRequestSchema.parse({
      commandId: "ea9c9a6c-0dc4-467d-87ee-3bf675a88f67",
      expectedSourceVersion: 14,
      eventId: "flugtag-2027",
      name: "Flugtag 2027",
      eventDate: "2027-06-12",
      aerodrome: "EDXX Testflugplatz",
      timeZone: "Europe/Berlin",
    });
    expect(parsed.eventId).toBe("flugtag-2027");
    expect("guestName" in parsed).toBe(false);
    expect(() => cloneEventRequestSchema.parse({ ...parsed, eventId: "Ungültige ID" })).toThrow();
  });

  it("keeps protected ticket search results free of public codes and guest data", () => {
    const parsed = ticketSearchResponseSchema.parse({
      results: [
        {
          ticketGroupId: "synthetic-group",
          productId: "synthetic-product",
          productCode: "PAN20",
          productName: "Panorama",
          groupStatus: "WAITING",
          groupSize: 2,
          queueSequence: 4,
          standby: false,
          soldAt: "2026-07-11T12:00:00.000Z",
          communicationNumber: 42,
          communicationLabel: "PAN20-042",
          rotationStatus: "DRAFT",
        },
      ],
    });
    expect(parsed.results).toHaveLength(1);
    const result = parsed.results[0];
    expect(result).toBeDefined();
    if (!result) throw new Error("Synthetischer Suchtreffer fehlt.");
    expect("publicCode" in result).toBe(false);
    expect("guestName" in result).toBe(false);
  });
});
