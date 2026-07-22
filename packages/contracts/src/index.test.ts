import { describe, expect, it } from "vitest";
import {
  adminDeviceRecoverySchema,
  aircraftOperationalSummarySchema,
  bootstrapRequestSchema,
  cloneEventRequestSchema,
  commandEnvelopeSchema,
  factoryResetRequestSchema,
  fidsPreferencesSchema,
  forecastHistoryQuerySchema,
  forecastHistorySchema,
  operationalHistoryQuerySchema,
  operationalHistorySchema,
  operatorRoleSchema,
  publicBoardSchema,
  publicTicketStatusSchema,
  rotationOperationalSummarySchema,
  stageOutageRecoveryRequestSchema,
  ticketGroupPrintDataSchema,
  ticketSearchRequestSchema,
  ticketSearchResponseSchema,
  updateFidsPreferencesSchema,
  updateOperatorAccountSchema,
} from "./index";

describe("commandEnvelopeSchema", () => {
  it("validates an explicit anonymous pilot assignment with reassign confirmation", () => {
    const command = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416299",
      eventId: "demo-2026",
      deviceId: "flight-director-1",
      expectedVersion: 8,
      issuedAt: "2026-07-20T12:00:00.000Z",
      type: "ASSIGN_AIRCRAFT_PILOT",
      payload: { aircraftId: "aircraft-1", pilotId: "pilot-1", reassign: false },
    });
    expect(command.type).toBe("ASSIGN_AIRCRAFT_PILOT");
  });

  it("accepts whole booking groups for an atomic multi-group call", () => {
    const command = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416200",
      eventId: "demo-2026",
      deviceId: "flight-line-1",
      expectedVersion: 7,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "CALL_NEXT",
      payload: {
        ticketGroupIds: ["group-2", "group-1"],
        aircraftId: "aircraft-1",
        pilotId: "pilot-1",
      },
    });
    expect(command.type === "CALL_NEXT" && command.payload.ticketGroupIds).toEqual([
      "group-2",
      "group-1",
    ]);
  });

  it("validates stored ticket codes only in the protected print DTO", () => {
    expect(
      ticketGroupPrintDataSchema.parse({
        ticketGroupId: "group-1",
        eventName: "Synthetischer Flugtag",
        productName: "Panorama",
        gateLabel: "Flight Line",
        communicationLabel: "PAN-101",
        tickets: [{ code: "ABCDE2345678", position: 1 }],
      }).tickets[0]?.code,
    ).toBe("ABCDE2345678");
  });
  it("allows an administrator to revoke account sessions without changing the PIN", () => {
    expect(updateOperatorAccountSchema.parse({ revokeSessions: true })).toEqual({
      revokeSessions: true,
    });
    expect(() => updateOperatorAccountSchema.parse({})).toThrow();
  });
  it("validates versioned FIDS preferences and the DISPLAY role", () => {
    expect(operatorRoleSchema.parse("DISPLAY")).toBe("DISPLAY");
    expect(
      fidsPreferencesSchema.parse({
        visibleRows: 8,
        layout: "DOUBLE",
        theme: "SYSTEM",
        version: 3,
      }),
    ).toEqual({ visibleRows: 8, layout: "DOUBLE", theme: "SYSTEM", version: 3 });
    expect(() =>
      updateFidsPreferencesSchema.parse({
        commandId: "550e8400-e29b-41d4-a716-446655440500",
        expectedVersion: 0,
        visibleRows: 21,
        layout: "SINGLE",
        theme: "DARK",
      }),
    ).toThrow();
  });
  it("accepts only a PIN and hashed client credential for admin recovery", () => {
    const parsed = adminDeviceRecoverySchema.parse({
      adminPin: "000000",
      credentialHash: "a".repeat(64),
    });
    expect(parsed.credentialHash).toHaveLength(64);
    expect(() =>
      adminDeviceRecoverySchema.parse({ adminPin: "0000", credentialHash: "plain-token" }),
    ).toThrow();
  });

  it("requires explicit, anonymous confirmation for a factory reset", () => {
    const parsed = factoryResetRequestSchema.parse({
      commandId: "550e8400-e29b-41d4-a716-446655440500",
      eventId: "synthetic-event",
      reason: "Entwicklungsstand neu aufbauen",
      adminPin: "0000",
      confirmation: "WERKSZUSTAND",
      retainRecoveryBackup: true,
      deleteAllBackups: false,
    });
    expect(parsed.confirmation).toBe("WERKSZUSTAND");
    expect(() => factoryResetRequestSchema.parse({ ...parsed, confirmation: "RESET" })).toThrow();
    expect(() =>
      factoryResetRequestSchema.parse({
        ...parsed,
        retainRecoveryBackup: true,
        deleteAllBackups: true,
      }),
    ).toThrow();
  });
  it("accepts first-run administration without browser-generated device credentials", () => {
    const parsed = bootstrapRequestSchema.parse({
      setupCode: "synthetic-first-run-code",
      adminPin: "000000",
      eventId: "synthetic-first-run",
      name: "Synthetischer Erststart",
      eventDate: "2026-07-12",
      aerodrome: "EDQA",
      timeZone: "Europe/Berlin",
    });
    expect(parsed.eventId).toBe("synthetic-first-run");
    expect("guestName" in parsed).toBe(false);
    expect("adminDeviceId" in parsed).toBe(false);
    expect("adminCredentialHash" in parsed).toBe(false);
    expect(() =>
      bootstrapRequestSchema.parse({ ...parsed, adminCredentialHash: "clear-device-token" }),
    ).toThrow();
    expect(() => bootstrapRequestSchema.parse({ ...parsed, timeZone: "Mars/Olympus" })).toThrow(
      "Ungültige IANA-Zeitzone",
    );
  });
  it("accepts anonymous, ordered paper recovery records without guest fields", () => {
    const parsed = stageOutageRecoveryRequestSchema.parse({
      batchId: "550e8400-e29b-41d4-a716-446655440090",
      expectedVersion: 12,
      entries: [
        {
          id: "550e8400-e29b-41d4-a716-446655440091",
          type: "PAPER_SALE",
          originalOccurredAt: "2026-07-11T12:00:00.000Z",
          paperSequence: 1,
          paperReference: "BELEG-001",
          payload: {
            productId: "panorama-20",
            publicTicketCodes: ["ABCDEFGHJKLM"],
            paymentStatus: "PAID",
            paymentMethod: "CASH",
          },
        },
      ],
    });

    expect(parsed.entries[0]?.type).toBe("PAPER_SALE");
    expect(JSON.stringify(parsed)).not.toMatch(/name|phone|telefon/i);
  });

  it("rejects guest identity fields in outage recovery records", () => {
    expect(() =>
      stageOutageRecoveryRequestSchema.parse({
        batchId: "550e8400-e29b-41d4-a716-446655440090",
        expectedVersion: 12,
        entries: [
          {
            id: "550e8400-e29b-41d4-a716-446655440091",
            type: "PAPER_SALE",
            originalOccurredAt: "2026-07-11T12:00:00.000Z",
            paperSequence: 1,
            paperReference: "BELEG-001",
            guestName: "Nicht zulässig",
            payload: {
              productId: "panorama-20",
              publicTicketCodes: ["ABCDEFGHJKLM"],
              paymentStatus: "PAID",
              paymentMethod: "CASH",
            },
          },
        ],
      }),
    ).toThrow();
  });

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

  it("requires an explicit transport flag for acknowledged oversized group splits", () => {
    const sale = {
      commandId: "550e8400-e29b-41d4-a716-446655440020",
      eventId: "synthetic-event",
      deviceId: "synthetic-cashier",
      expectedVersion: 2,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "SELL_TICKET_GROUP",
      payload: {
        productId: "synthetic-product",
        publicTicketCodes: ["ABCDEFGHJKLM"],
        standby: false,
        paymentStatus: "PAID",
        paymentMethod: "CASH",
      },
    } as const;
    const ordinary = commandEnvelopeSchema.parse(sale);
    const acknowledged = commandEnvelopeSchema.parse({
      ...sale,
      payload: { ...sale.payload, oversizeSplitAcknowledged: true },
    });
    expect(
      ordinary.type === "SELL_TICKET_GROUP" && ordinary.payload.oversizeSplitAcknowledged,
    ).toBe(false);
    expect(
      acknowledged.type === "SELL_TICKET_GROUP" && acknowledged.payload.oversizeSplitAcknowledged,
    ).toBe(true);
  });

  it("validates a reasoned whole-group move without guest or safety data", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "550e8400-e29b-41d4-a716-446655440021",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-line",
      expectedVersion: 3,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "MOVE_TICKET_GROUP",
      payload: {
        ticketGroupId: "synthetic-group",
        targetRotationId: "synthetic-target",
        reason: "Manuell bestätigte Nachbesetzung",
      },
    });
    expect(parsed.type).toBe("MOVE_TICKET_GROUP");
    expect(JSON.stringify(parsed)).not.toMatch(/guest|name|safe|freigabe/i);
  });

  it("validates an administrator manifest correction without personal data", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "550e8400-e29b-41d4-a716-446655440031",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 4,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "CORRECT_ROTATION_MANIFEST",
      payload: {
        ticketGroupId: "synthetic-group",
        targetRotationId: "synthetic-target",
        reason: "Tatsächliche Gruppenbesetzung nachträglich richtigstellen",
        adminPin: "0000",
      },
    });
    expect(parsed.type).toBe("CORRECT_ROTATION_MANIFEST");
    expect(JSON.stringify(parsed)).not.toMatch(/guestName|phoneNumber|passengerName/);
  });

  it("validates typed gate display filters without duplicating gate assignments", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "550e8400-e29b-41d4-a716-446655440032",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 4,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "UPSERT_GATE",
      payload: {
        gateId: "synthetic-gate",
        label: "Flight Line 1",
        gateType: "FLIGHT_LINE",
        active: true,
        sortOrder: 10,
        displayFilter: {
          productIds: ["synthetic-product"],
          rotationStatuses: ["DRAFT", "CALLED"],
        },
        reason: "Synthetischen Anzeigefilter konfigurieren",
        adminPin: "0000",
      },
    });
    expect(parsed.type === "UPSERT_GATE" && parsed.payload.displayFilter).toEqual({
      productIds: ["synthetic-product"],
      rotationStatuses: ["DRAFT", "CALLED"],
    });
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

  it("forbids direct forecast overrides in operational commands", () => {
    const base = {
      commandId: "550e8400-e29b-41d4-a716-446655440099",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-lead",
      expectedVersion: 4,
      issuedAt: "2026-07-11T12:00:00.000Z",
    };
    expect(() =>
      commandEnvelopeSchema.parse({
        ...base,
        type: "SET_EVENT_INTERRUPTION",
        payload: {
          interrupted: true,
          reason: "Synthetische Wetterunterbrechung",
          expectedReviewAt: null,
          predictedDepartureAt: "2026-07-11T12:30:00.000Z",
        },
      }),
    ).toThrow();
    expect(() =>
      commandEnvelopeSchema.parse({
        ...base,
        type: "SET_FORECAST_TIME",
        payload: {
          rotationId: "synthetic-rotation",
          predictedDepartureAt: "2026-07-11T12:30:00.000Z",
        },
      }),
    ).toThrow();
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
      payload: {
        ticketGroupIds: ["ticket-group-1"],
        aircraftId: "aircraft-1",
        pilotId: "pilot-code-1",
      },
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
      eventId: "event-1",
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
      selectedGate: null,
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
          ticketLabels: ["PAN-101/1"],
          aircraftRegistration: null,
          departedAt: null,
          status: "WAITING",
          waitLowerMinutes: 0,
          waitUpperMinutes: 30,
          operationalNotice: "",
        },
      ],
      fleet: [{ registration: "D-EAAA", status: "AVAILABLE", refuelPlanned: false }],
    });
    expect("aircraftRegistration" in status).toBe(false);
    expect("guestName" in board).toBe(false);
    expect(() =>
      publicTicketStatusSchema.parse({
        ...status,
        predictedBoardingAt: "2026-07-11T12:15:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      publicBoardSchema.parse({
        ...board,
        groups: [
          {
            ...board.groups[0],
            predictedDepartureAt: "2026-07-11T12:20:00.000Z",
          },
        ],
      }),
    ).toThrow();
    expect(
      publicTicketStatusSchema.parse({
        ...status,
        status: "SERVICE_PAUSED",
        queuePosition: null,
        waitLowerMinutes: 0,
        waitUpperMinutes: 0,
        predictionQuality: "UNCERTAIN",
        message: "Organisatorischer Betrieb pausiert – bitte später erneut prüfen.",
      }).status,
    ).toBe("SERVICE_PAUSED");
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

  it("keeps no-show and incomplete-attendance decisions anonymous and explicit", () => {
    const noShow = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416291",
      eventId: "demo-2026",
      deviceId: "flight-line-tablet-1",
      expectedVersion: 10,
      issuedAt: "2026-07-11T12:10:00.000Z",
      type: "MARK_TICKET_NO_SHOW",
      payload: { ticketId: "internal-ticket-id", reason: "Frist abgelaufen" },
    });
    const decision = commandEnvelopeSchema.parse({
      commandId: "00e971df-23d5-4d28-9107-92b447416292",
      eventId: "demo-2026",
      deviceId: "flight-line-tablet-1",
      expectedVersion: 11,
      issuedAt: "2026-07-11T12:11:00.000Z",
      type: "CONFIRM_ATTENDANCE_DECISION",
      payload: { rotationId: "rotation-id", decision: "LEAVE_SEAT_EMPTY" },
    });
    expect(noShow.type).toBe("MARK_TICKET_NO_SHOW");
    expect(decision.type).toBe("CONFIRM_ATTENDANCE_DECISION");
    expect(JSON.stringify([noShow, decision])).not.toMatch(/name|phone|telefon/i);
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
        automaticPrecallEnabled: true,
        precallLeadMinutes: 15,
        maximumGateWaitMinutes: 20,
        precallMinimumQuality: "CHANGING",
        precallGateCooldownMinutes: 2,
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
        promisedFlightMinutes: 20,
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

  it("keeps disabled weight capture exclusive", () => {
    const invalid = commandEnvelopeSchema.safeParse({
      commandId: "550e8400-e29b-41d4-a716-446655440080",
      eventId: "event-1",
      deviceId: "admin-1",
      expectedVersion: 1,
      issuedAt: "2026-07-14T10:00:00.000Z",
      type: "UPSERT_PRODUCT",
      payload: {
        productId: "product-1",
        resourceGroupId: "resource-1",
        gateId: "gate-1",
        name: "Panorama",
        code: "PAN20",
        publicDescription: "Panoramaflug",
        priceCents: 4500,
        referenceCapacity: 3,
        referenceDurationMinutes: 20,
        promisedFlightMinutes: 20,
        childCompanionRequired: false,
        weightClasses: ["NOT_CAPTURED", "CHILD"],
        sortOrder: 10,
        reason: "Synthetischer Vertragstest",
        adminPin: "0000",
      },
    });

    expect(invalid.success).toBe(false);
  });

  it("requires the child class for the companion warning", () => {
    const invalid = commandEnvelopeSchema.safeParse({
      commandId: "550e8400-e29b-41d4-a716-446655440081",
      eventId: "event-1",
      deviceId: "admin-1",
      expectedVersion: 1,
      issuedAt: "2026-07-14T10:00:00.000Z",
      type: "UPSERT_PRODUCT",
      payload: {
        productId: "product-1",
        resourceGroupId: "resource-1",
        gateId: "gate-1",
        name: "Panorama",
        code: "PAN20",
        publicDescription: "Panoramaflug",
        priceCents: 4500,
        referenceCapacity: 3,
        referenceDurationMinutes: 20,
        promisedFlightMinutes: 20,
        childCompanionRequired: true,
        weightClasses: ["NORMAL"],
        sortOrder: 10,
        reason: "Synthetischer Vertragstest",
        adminPin: "0000",
      },
    });

    expect(invalid.success).toBe(false);
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

  it("requires an administrator PIN for master-data deletion", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "80cd849e-5a0e-49f7-827f-69b84b261164",
      eventId: "demo-2026",
      deviceId: "technical-scaffold",
      expectedVersion: 15,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "DELETE_MASTER_DATA",
      payload: {
        entityType: "AIRCRAFT",
        entityId: "aircraft-a",
        reason: "Administrative Stammdatenlöschung",
        adminPin: "0000",
      },
    });
    expect(parsed.type).toBe("DELETE_MASTER_DATA");
    expect(() =>
      commandEnvelopeSchema.parse({
        ...parsed,
        payload: { ...parsed.payload, adminPin: "" },
      }),
    ).toThrow();
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
    expect(() => cloneEventRequestSchema.parse({ ...parsed, timeZone: "Berlin" })).toThrow(
      "Ungültige IANA-Zeitzone",
    );
    expect(parsed.restartMode).toBe("KEEP_MASTER_DATA");
    expect(cloneEventRequestSchema.parse({ ...parsed, restartMode: "EMPTY" }).restartMode).toBe(
      "EMPTY",
    );
  });

  it("keeps protected ticket search results free of public codes and guest data", () => {
    const parsed = ticketSearchResponseSchema.parse({
      results: [
        {
          ticketGroupId: "synthetic-group",
          productId: "synthetic-product",
          productCode: "PAN20",
          productName: "Panorama",
          groupStatus: "QUEUED",
          groupSize: 2,
          queueSequence: 4,
          bookingGroupNumber: 104,
          bookingGroupLabel: "G-0104",
          standby: false,
          soldAt: "2026-07-11T12:00:00.000Z",
          communicationNumber: 42,
          communicationLabel: "PAN20-042",
          communicationNumbers: [42, 43],
          communicationLabels: ["PAN20-042", "PAN20-043"],
          rotationStatus: "DRAFT",
          rotationStatuses: ["DRAFT"],
        },
      ],
      nextCursor: "synthetic-cursor",
    });
    expect(parsed.results).toHaveLength(1);
    const result = parsed.results[0];
    expect(result).toBeDefined();
    if (!result) throw new Error("Synthetischer Suchtreffer fehlt.");
    expect("publicCode" in result).toBe(false);
    expect("guestName" in result).toBe(false);
  });

  it("validates cursor pagination and rejects the removed rebooking command", () => {
    expect(
      ticketSearchRequestSchema.parse({ q: "G-0104", status: "ACTIVE", limit: 50 }),
    ).toMatchObject({ q: "G-0104", status: "ACTIVE", limit: 50 });
    expect(() =>
      ticketSearchRequestSchema.parse({ cursor: "cursor", ticketGroupIds: ["group-1"] }),
    ).toThrow();
    expect(() =>
      commandEnvelopeSchema.parse({
        commandId: "750fa7d8-234b-4a8b-bd4a-91b1294c78b3",
        eventId: "synthetic-event",
        deviceId: "cashier-1",
        expectedVersion: 3,
        issuedAt: "2026-07-20T12:00:00.000Z",
        type: "REBOOK_TICKET_GROUP",
        payload: {
          ticketGroupId: "group-1",
          newProductId: "product-2",
          reason: "Nicht mehr zulässig",
          adminPin: "SESSION",
        },
      }),
    ).toThrow();
  });

  it("validates an auditable event lifecycle command", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "7e7839a6-0ab3-4508-82da-96db7de7d851",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 4,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "SET_EVENT_LIFECYCLE",
      payload: {
        status: "CLOSED",
        reason: "Veranstaltungstag abgeschlossen",
        adminPin: "0000",
      },
    });
    expect(parsed.type).toBe("SET_EVENT_LIFECYCLE");
  });

  it("requires a reason for aborting a called rotation", () => {
    const base = {
      commandId: "a8557fe5-e707-4a6e-a8a7-ae8b540c9148",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-line",
      expectedVersion: 8,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "ABORT_ROTATION",
    } as const;
    expect(
      commandEnvelopeSchema.parse({
        ...base,
        payload: { rotationId: "synthetic-rotation", reason: "Bodenabbruch vor Start" },
      }).type,
    ).toBe("ABORT_ROTATION");
    expect(() =>
      commandEnvelopeSchema.parse({
        ...base,
        payload: { rotationId: "synthetic-rotation", reason: "" },
      }),
    ).toThrow();
  });

  it("requires aggregate versions and a reason for a technical rotation abort", () => {
    const command = {
      commandId: "d37fd013-b250-4e72-a5fd-39551088043d",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-line",
      expectedVersion: 9,
      issuedAt: "2026-07-21T12:00:00.000Z",
      type: "ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE",
      payload: {
        rotationId: "synthetic-rotation",
        expectedRotationVersion: 3,
        expectedAircraftVersion: 7,
        reason: "Technisches Problem beim Run-Up",
      },
    } as const;
    expect(commandEnvelopeSchema.parse(command).type).toBe(
      "ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE",
    );
    expect(() =>
      commandEnvelopeSchema.parse({
        ...command,
        payload: { ...command.payload, reason: "" },
      }),
    ).toThrow();
    const { expectedAircraftVersion: _omitted, ...stalePayload } = command.payload;
    expect(() => commandEnvelopeSchema.parse({ ...command, payload: stalePayload })).toThrow();
  });

  it("keeps plan, forecast and actual rotation timestamps separate", () => {
    const parsed = rotationOperationalSummarySchema.parse({
      id: "synthetic-rotation",
      version: 4,
      flightGroupId: "synthetic-flight-group",
      communicationNumber: 42,
      communicationLabel: "PAN-042",
      queuePosition: 3,
      productCode: "PAN",
      productName: "Panorama",
      status: "IN_FLIGHT",
      ticketGroupId: "synthetic-ticket-group",
      gateId: "synthetic-gate",
      gateLabel: "Flight Line 1",
      aircraftId: "synthetic-aircraft",
      aircraftRegistration: "D-ETST",
      pilotId: "synthetic-pilot",
      pilotOperationalCode: "P-01",
      suggestedPilotId: null,
      suggestedPilotOperationalCode: null,
      suggestedAircraftId: null,
      suggestedAircraftRegistration: null,
      ticketCount: 2,
      baselineCapacity: 4,
      usableCapacity: 3,
      capacityReduced: true,
      estimatedPassengerPayloadKg: 107,
      predictedLowerMinutes: 0,
      predictedUpperMinutes: 25,
      calledAt: "2026-07-11T12:05:00.000Z",
      deferralCount: 0,
      operationalNote: "Nur organisatorischer Testhinweis",
      timeline: {
        planned: {
          boardingAt: "2026-07-11T12:00:00.000Z",
          departureAt: "2026-07-11T12:08:00.000Z",
          landingAt: "2026-07-11T12:28:00.000Z",
          completionAt: "2026-07-11T12:36:00.000Z",
        },
        predicted: {
          boardingAt: "2026-07-11T12:05:00.000Z",
          departureAt: "2026-07-11T12:13:00.000Z",
          landingAt: "2026-07-11T12:33:00.000Z",
          completionAt: "2026-07-11T12:41:00.000Z",
        },
        actual: {
          boardingAt: "2026-07-11T12:05:00.000Z",
          departureAt: "2026-07-11T12:14:00.000Z",
          landingAt: null,
          completionAt: null,
        },
        predictionQuality: "CHANGING",
        predictionUpdatedAt: "2026-07-11T12:14:00.000Z",
      },
      tickets: [],
    });
    expect(parsed.timeline.planned.departureAt).not.toBe(parsed.timeline.actual.departureAt);
    expect(parsed.timeline.predicted.landingAt).toBeTruthy();
    expect(parsed.gateId).toBe("synthetic-gate");
    expect(parsed.operationalNote).toBe("Nur organisatorischer Testhinweis");
  });

  it("validates an anonymous, auditable rotation note", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "2b428d92-224f-47ea-8d68-89f5d69158ed",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-line",
      expectedVersion: 8,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "SET_ROTATION_NOTE",
      payload: {
        rotationId: "synthetic-rotation",
        note: "Organisatorischer Hinweis 42",
        reason: "Hinweis aktualisiert",
      },
    });
    expect(parsed.type).toBe("SET_ROTATION_NOTE");
    expect("guestName" in parsed.payload).toBe(false);
  });

  it("validates a reasoned usable-capacity reduction without safety semantics", () => {
    const parsed = commandEnvelopeSchema.parse({
      commandId: "2b428d92-224f-47ea-8d68-89f5d69158ee",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-line",
      expectedVersion: 9,
      issuedAt: "2026-07-11T12:00:00.000Z",
      type: "SET_ROTATION_CAPACITY",
      payload: {
        rotationId: "synthetic-rotation",
        usableCapacity: 3,
        reason: "Organisatorisch nutzbare Plätze reduziert",
      },
    });
    expect(parsed.type).toBe("SET_ROTATION_CAPACITY");
    expect(JSON.stringify(parsed)).not.toMatch(/safe|freigabe|gewicht|zuladung/i);
  });
});

describe("aircraftOperationalSummarySchema", () => {
  const aircraft = {
    id: "aircraft-1",
    version: 2,
    registration: "D-TEST",
    aircraftType: "SYNTHETIC",
    passengerSeats: 4,
    maximumPassengerPayloadKg: null,
    operationalState: "AVAILABLE",
    operationalStateChangedAt: "2026-07-20T12:00:00.000Z",
    resourceGroupId: "rg-1",
    resourceGroupName: "Rundflug",
    resourceGroupShortCode: "RF",
    refuelPlanned: false,
    rotationsSinceRefuel: 0,
    refuelReminderThreshold: 5,
    expectedReviewAt: null,
    currentPilotId: null,
    currentPilotOperationalCode: null,
  } as const;

  it("requires the persisted operational state transition timestamp", () => {
    expect(aircraftOperationalSummarySchema.parse(aircraft).operationalStateChangedAt).toBe(
      aircraft.operationalStateChangedAt,
    );
    const { operationalStateChangedAt: _omitted, ...withoutTimestamp } = aircraft;
    expect(() => aircraftOperationalSummarySchema.parse(withoutTimestamp)).toThrow();
  });
});

describe("operational history contracts", () => {
  it("normalizes bounded entity and time filters", () => {
    const parsed = operationalHistoryQuerySchema.parse({
      aircraftId: "synthetic-aircraft",
      pilotId: "synthetic-pilot",
      communicationNumber: "123",
      ticketStatus: "COMPLETED",
      rotationStatus: "COMPLETED",
      since: "2026-07-11T08:00:00.000Z",
      until: "2026-07-11T18:00:00.000Z",
      limit: "50",
      offset: "100",
    });

    expect(parsed.communicationNumber).toBe(123);
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(100);
  });

  it("rejects reversed ranges and unknown statuses", () => {
    expect(() =>
      operationalHistoryQuerySchema.parse({
        since: "2026-07-11T18:00:00.000Z",
        until: "2026-07-11T08:00:00.000Z",
      }),
    ).toThrow();
    expect(() => operationalHistoryQuerySchema.parse({ ticketStatus: "UNKNOWN" })).toThrow();
  });

  it("describes an anonymous ticket-to-rotation history row", () => {
    const parsed = operationalHistorySchema.parse({
      entries: [
        {
          ticketId: "ticket-synthetic-1",
          ticketGroupId: "group-synthetic-1",
          ticketStatus: "COMPLETED",
          soldAt: "2026-07-11T08:00:00.000Z",
          assignmentActive: true,
          assignedAt: "2026-07-11T08:01:00.000Z",
          releasedAt: null,
          rotationId: "rotation-synthetic-1",
          rotationStatus: "COMPLETED",
          flightGroupId: "flight-group-synthetic-1",
          communicationNumber: 123,
          communicationLabel: "SYN-123",
          productId: "product-synthetic",
          productCode: "SYN",
          productName: "Synthetischer Rundflug",
          resourceGroupId: "resource-synthetic",
          resourceGroupName: "Synthetische Ressource",
          gateId: "gate-synthetic",
          gateLabel: "Synthetisches Gate",
          aircraftId: "aircraft-synthetic",
          aircraftRegistration: "D-TEST",
          pilotId: "pilot-synthetic",
          pilotOperationalCode: "P-01",
          calledAt: "2026-07-11T08:10:00.000Z",
          departedAt: "2026-07-11T08:15:00.000Z",
          landedAt: "2026-07-11T08:35:00.000Z",
          completedAt: "2026-07-11T08:40:00.000Z",
          latestAt: "2026-07-11T08:40:00.000Z",
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });

    expect(parsed.entries[0]?.communicationLabel).toBe("SYN-123");
    expect(JSON.stringify(parsed)).not.toMatch(/guest|phone|telefon/i);
  });
});

describe("forecast history contracts", () => {
  it("normalizes bounded filters and rejects reversed time ranges", () => {
    const parsed = forecastHistoryQuerySchema.parse({
      rotationId: "synthetic-rotation",
      since: "2026-07-11T08:00:00.000Z",
      until: "2026-07-11T18:00:00.000Z",
      limit: "25",
      offset: "50",
    });
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(50);
    expect(() =>
      forecastHistoryQuerySchema.parse({
        since: "2026-07-11T18:00:00.000Z",
        until: "2026-07-11T08:00:00.000Z",
      }),
    ).toThrow();
  });

  it("keeps prediction basis and actual deviations anonymous", () => {
    const parsed = forecastHistorySchema.parse({
      entries: [
        {
          snapshotId: "snapshot-synthetic",
          rotationId: "rotation-synthetic",
          flightGroupId: "flight-group-synthetic",
          communicationNumber: 42,
          communicationLabel: "SYN-042",
          aircraftId: "aircraft-synthetic",
          aircraftRegistration: "D-TEST",
          pilotId: "pilot-synthetic",
          pilotOperationalCode: "P-01",
          operationDayVersion: 12,
          capturedAt: "2026-07-11T08:00:00.000Z",
          triggerEventType: "ROTATION_IN_FLIGHT",
          quality: "CHANGING",
          lowerMinutes: 4,
          upperMinutes: 8,
          dataBasisScope: "AIRCRAFT_PRODUCT_HISTORY",
          sampleSize: 6,
          dataAgeMinutes: 15,
          activeCapacity: 2,
          referenceDurationMinutes: 35,
          predicted: {
            boardingAt: "2026-07-11T08:04:00.000Z",
            departureAt: "2026-07-11T08:10:00.000Z",
            landingAt: "2026-07-11T08:30:00.000Z",
            completionAt: "2026-07-11T08:35:00.000Z",
          },
          actual: {
            boardingAt: "2026-07-11T08:05:00.000Z",
            departureAt: "2026-07-11T08:12:00.000Z",
            landingAt: "2026-07-11T08:33:00.000Z",
            completionAt: "2026-07-11T08:39:00.000Z",
          },
          deviationMinutes: { boarding: 1, departure: 2, landing: 3, completion: 4 },
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });

    expect(parsed.entries[0]?.triggerEventType).toBe("ROTATION_IN_FLIGHT");
    expect(parsed.entries[0]?.deviationMinutes.completion).toBe(4);
    expect(JSON.stringify(parsed)).not.toMatch(/guest|phone|telefon/i);
  });
});
