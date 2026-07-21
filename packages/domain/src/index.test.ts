import { describe, expect, it } from "vitest";
import {
  aircraftOperationalStateLabels,
  assertGroupIsNotAutomaticallySplit,
  assertPublicTicketCode,
  assertRoleMayExecute,
  assertSaleAllowed,
  assertSingleActiveResourceGroup,
  assertTechnicalRotationAbortAllowed,
  assertTicketNoShowAllowed,
  DomainRuleError,
  planTechnicalRotationAbortQueueBlock,
  rotationStateLabels,
  transitionAircraft,
  transitionRotation,
} from "./index";

describe("aircraft lifecycle", () => {
  it("requires a separate post-landing completion path", () => {
    expect(transitionAircraft("IN_FLIGHT", "LANDED")).toBe("LANDED");
    expect(() => transitionAircraft("LANDED", "AVAILABLE")).toThrow(DomainRuleError);
    expect(transitionAircraft("LANDED", "TURNAROUND")).toBe("TURNAROUND");
    expect(transitionAircraft("TURNAROUND", "AVAILABLE")).toBe("AVAILABLE");
  });

  it("supports reversible operational blocks without bypassing the lifecycle", () => {
    expect(transitionAircraft("AVAILABLE", "INACTIVE")).toBe("INACTIVE");
    expect(transitionAircraft("INACTIVE", "AVAILABLE")).toBe("AVAILABLE");
    expect(transitionAircraft("AVAILABLE", "PAUSED")).toBe("PAUSED");
    expect(transitionAircraft("PAUSED", "AVAILABLE")).toBe("AVAILABLE");
    expect(transitionAircraft("AVAILABLE", "REFUELING")).toBe("REFUELING");
    expect(transitionAircraft("REFUELING", "AVAILABLE")).toBe("AVAILABLE");
  });
});

describe("command authorization", () => {
  it("allows a cashier to sell", () => {
    expect(() => assertRoleMayExecute("CASHIER", "SELL_TICKET_GROUP")).not.toThrow();
  });

  it("allows only flight-line roles and administrators to move whole ticket groups", () => {
    expect(() => assertRoleMayExecute("FLIGHT_LINE", "MOVE_TICKET_GROUP")).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "MOVE_TICKET_GROUP")).not.toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "MOVE_TICKET_GROUP")).toThrowError(
      /darf MOVE_TICKET_GROUP nicht/,
    );
  });

  it("reserves post-departure manifest corrections for administrators", () => {
    expect(() => assertRoleMayExecute("ADMIN", "CORRECT_ROTATION_MANIFEST")).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "CORRECT_ROTATION_MANIFEST")).toThrowError(
      /darf CORRECT_ROTATION_MANIFEST nicht/,
    );
  });

  it("rejects a display device for operational commands", () => {
    expect(() => assertRoleMayExecute("CASHIER", "CALL_NEXT")).toThrowError(/darf CALL_NEXT nicht/);
  });

  it("allows flight-line roles to abort a called rotation but not cashiers", () => {
    expect(() => assertRoleMayExecute("FLIGHT_LINE", "ABORT_ROTATION")).not.toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "ABORT_ROTATION")).toThrowError(
      /darf ABORT_ROTATION nicht/,
    );
  });

  it("reserves live product sales configuration for administrators", () => {
    expect(() => assertRoleMayExecute("CASHIER", "CONFIGURE_PRODUCT_SALES")).toThrowError(
      /darf CONFIGURE_PRODUCT_SALES nicht/,
    );
    expect(() => assertRoleMayExecute("ADMIN", "CONFIGURE_PRODUCT_SALES")).not.toThrow();
  });

  it("reserves device pairing and revocation for administrators", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "PAIR_DEVICE")).toThrowError(
      /darf PAIR_DEVICE nicht/,
    );
    expect(() => assertRoleMayExecute("ADMIN", "PAIR_DEVICE")).not.toThrow();
    expect(() => assertRoleMayExecute("ADMIN", "REVOKE_DEVICE")).not.toThrow();
  });

  it("lets Flight Line control reversible aircraft blocks but not fleet configuration", () => {
    expect(() => assertRoleMayExecute("FLIGHT_LINE", "SCHEDULE_AIRCRAFT_REFUEL")).not.toThrow();
    expect(() =>
      assertRoleMayExecute("FLIGHT_LINE", "SET_AIRCRAFT_OPERATIONAL_STATE"),
    ).not.toThrow();
    expect(() =>
      assertRoleMayExecute("FLIGHT_DIRECTOR", "SET_AIRCRAFT_OPERATIONAL_STATE"),
    ).not.toThrow();
  });

  it("reserves anonymous pilot-code administration for administrators", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "UPSERT_PILOT")).toThrowError(
      /darf UPSERT_PILOT nicht/,
    );
    expect(() => assertRoleMayExecute("ADMIN", "UPSERT_PILOT")).not.toThrow();
  });

  it("allows only flight direction and administration to assign an aircraft pilot", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "ASSIGN_AIRCRAFT_PILOT")).not.toThrow();
    expect(() => assertRoleMayExecute("ADMIN", "ASSIGN_AIRCRAFT_PILOT")).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_LINE", "ASSIGN_AIRCRAFT_PILOT")).toThrowError(
      /darf ASSIGN_AIRCRAFT_PILOT nicht/,
    );
  });

  it("protects the refuel reminder threshold as administration", () => {
    expect(() =>
      assertRoleMayExecute("FLIGHT_DIRECTOR", "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD"),
    ).toThrowError(/darf CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD nicht/);
    expect(() =>
      assertRoleMayExecute("ADMIN", "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD"),
    ).not.toThrow();
  });

  it("allows operational leads to publish non-safety resource notices", () => {
    expect(() =>
      assertRoleMayExecute("FLIGHT_DIRECTOR", "SET_RESOURCE_GROUP_NOTICE"),
    ).not.toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "SET_RESOURCE_GROUP_NOTICE")).toThrowError(
      /darf SET_RESOURCE_GROUP_NOTICE nicht/,
    );
  });

  it("allows flight direction to trigger but not clear emergency mode", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "TRIGGER_EMERGENCY")).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "CLEAR_EMERGENCY")).toThrowError(
      /darf CLEAR_EMERGENCY nicht/,
    );
  });
});

describe("German operational status labels", () => {
  it("never exposes technical aircraft or rotation states", () => {
    expect(aircraftOperationalStateLabels.IN_FLIGHT).toBe("Im Flug");
    expect(aircraftOperationalStateLabels.INTERRUPTED).toBe("Nicht verfügbar");
    expect(rotationStateLabels.CALLED).toBe("Boarding");
    expect(rotationStateLabels.COMPLETED).toBe("Abgeschlossen");
    expect(
      Object.values({ ...aircraftOperationalStateLabels, ...rotationStateLabels }),
    ).not.toContain("IN_FLIGHT");
  });
});

describe("sale guard", () => {
  it("allows sales only in an active normal operating state", () => {
    expect(() =>
      assertSaleAllowed({
        eventStatus: "ACTIVE",
        productSaleEnabled: true,
        resourceGroupStatus: "ACTIVE",
        emergencyMode: false,
        eventInterrupted: false,
        saleClosingReached: false,
      }),
    ).not.toThrow();
  });

  it("blocks sales in emergency mode", () => {
    expect(() =>
      assertSaleAllowed({
        eventStatus: "ACTIVE",
        productSaleEnabled: true,
        resourceGroupStatus: "ACTIVE",
        emergencyMode: true,
        eventInterrupted: false,
        saleClosingReached: false,
      }),
    ).toThrowError(/Notfallmodus/);
  });

  it("blocks sales during a normal event interruption", () => {
    expect(() =>
      assertSaleAllowed({
        eventStatus: "ACTIVE",
        productSaleEnabled: true,
        resourceGroupStatus: "ACTIVE",
        emergencyMode: false,
        eventInterrupted: true,
        saleClosingReached: false,
      }),
    ).toThrowError(/Betriebsunterbrechung/);
  });

  it("blocks sales outside the active event phase", () => {
    expect(() =>
      assertSaleAllowed({
        eventStatus: "CLOSED",
        productSaleEnabled: true,
        resourceGroupStatus: "ACTIVE",
        emergencyMode: false,
        eventInterrupted: false,
        saleClosingReached: false,
      }),
    ).toThrowError(/nicht für den Verkauf aktiv/);
  });

  it("allows lifecycle changes only for administrators", () => {
    expect(() => assertRoleMayExecute("ADMIN", "SET_EVENT_LIFECYCLE")).not.toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "SET_EVENT_LIFECYCLE")).toThrowError(
      /darf SET_EVENT_LIFECYCLE nicht/,
    );
  });

  it("allows rotation notes only for operational roles", () => {
    expect(() => assertRoleMayExecute("FLIGHT_LINE", "SET_ROTATION_NOTE")).not.toThrow();
    expect(() => assertRoleMayExecute("ADMIN", "SET_ROTATION_NOTE")).not.toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "SET_ROTATION_NOTE")).toThrowError(
      /darf SET_ROTATION_NOTE nicht/,
    );
  });

  it("allows usable rotation capacity changes only for operational roles", () => {
    expect(() => assertRoleMayExecute("FLIGHT_LINE", "SET_ROTATION_CAPACITY")).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "SET_ROTATION_CAPACITY")).not.toThrow();
    expect(() => assertRoleMayExecute("ADMIN", "SET_ROTATION_CAPACITY")).not.toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "SET_ROTATION_CAPACITY")).toThrowError(
      /darf SET_ROTATION_CAPACITY nicht/,
    );
  });

  it("allows operational leads to interrupt the event without emergency semantics", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "SET_EVENT_INTERRUPTION")).not.toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "SET_EVENT_INTERRUPTION")).toThrowError(
      /darf SET_EVENT_INTERRUPTION nicht/,
    );
  });

  it("allows operational leads but not cashiers to manage anonymous pilot pauses", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "SET_PILOT_PAUSE")).not.toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "SET_PILOT_PAUSE")).toThrowError(
      /darf SET_PILOT_PAUSE nicht/,
    );
  });
});

describe("public ticket codes", () => {
  it("normalizes a sufficiently long non-ambiguous code", () => {
    expect(assertPublicTicketCode("abcde2345678")).toBe("ABCDE2345678");
  });

  it("rejects short enumerable codes", () => {
    expect(() => assertPublicTicketCode("1234")).toThrow(DomainRuleError);
  });
});

describe("resource group invariant", () => {
  it("rejects two active memberships for one aircraft", () => {
    expect(() =>
      assertSingleActiveResourceGroup(
        [
          {
            aircraftId: "D-EABC",
            resourceGroupId: "standard",
            activeFrom: "2026-07-11",
            activeUntil: null,
          },
          {
            aircraftId: "D-EABC",
            resourceGroupId: "special",
            activeFrom: "2026-07-11",
            activeUntil: null,
          },
        ],
        "D-EABC",
      ),
    ).toThrowError(/nur einer aktiven Ressourcengruppe/);
  });
});

describe("group protection", () => {
  it("rejects an unconfirmed automatic split", () => {
    expect(() =>
      assertGroupIsNotAutomaticallySplit({
        groupSize: 3,
        selectedPassengers: 2,
        explicitlyConfirmedByHuman: false,
      }),
    ).toThrowError(/niemals automatisch getrennt/);
  });
});

describe("rotation lifecycle", () => {
  it("does not equate landed with completed", () => {
    expect(transitionRotation("IN_FLIGHT", "LANDED")).toBe("LANDED");
    expect(transitionRotation("LANDED", "COMPLETED")).toBe("COMPLETED");
  });

  it("allows an exceptional technical abort during boarding and after off-block", () => {
    expect(() => assertTechnicalRotationAbortAllowed("CALLED")).not.toThrow();
    expect(() => assertTechnicalRotationAbortAllowed("IN_FLIGHT")).not.toThrow();
  });

  it("rejects a technical abort before boarding and after on-block", () => {
    expect(() => assertTechnicalRotationAbortAllowed("DRAFT")).toThrowError(
      /nur während Boarding oder nach Off-Block/,
    );
    expect(() => assertTechnicalRotationAbortAllowed("LANDED")).toThrowError(
      /nur während Boarding oder nach Off-Block/,
    );
  });

  it("returns multiple groups as one stable block at the front of the queue", () => {
    expect(
      planTechnicalRotationAbortQueueBlock([
        { id: "group-c", queueSequence: 8, assignedAt: "2026-07-21T10:03:00.000Z" },
        { id: "group-a", queueSequence: 4, assignedAt: "2026-07-21T10:01:00.000Z" },
        { id: "group-b", queueSequence: 4, assignedAt: "2026-07-21T10:02:00.000Z" },
      ]),
    ).toEqual([
      { id: "group-a", queueSequence: 1 },
      { id: "group-b", queueSequence: 2 },
      { id: "group-c", queueSequence: 3 },
    ]);
    expect(() => planTechnicalRotationAbortQueueBlock([])).toThrow("keine rückstellbare");
  });
});

describe("attendance authorization", () => {
  it("allows flight line but not cashier devices to toggle attendance", () => {
    expect(() => assertRoleMayExecute("FLIGHT_LINE", "SET_TICKET_ATTENDANCE")).not.toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "SET_TICKET_ATTENDANCE")).toThrowError(
      /darf SET_TICKET_ATTENDANCE nicht/,
    );
  });

  it("allows only operational flight-line roles to resolve attendance exceptions", () => {
    expect(() => assertRoleMayExecute("FLIGHT_LINE", "MARK_TICKET_NO_SHOW")).not.toThrow();
    expect(() =>
      assertRoleMayExecute("FLIGHT_DIRECTOR", "CONFIRM_ATTENDANCE_DECISION"),
    ).not.toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "MARK_TICKET_NO_SHOW")).toThrow();
    expect(() => assertRoleMayExecute("CASHIER", "CONFIRM_ATTENDANCE_DECISION")).toThrow();
  });
});

describe("anonymous no-show deadline", () => {
  it("allows only a missing called ticket after the configured deadline", () => {
    expect(() =>
      assertTicketNoShowAllowed({
        rotationState: "CALLED",
        calledAt: "2026-07-11T10:00:00.000Z",
        attendanceStatus: "NOT_CHECKED_IN",
        noShowAfterMinutes: 10,
        now: "2026-07-11T10:10:00.000Z",
      }),
    ).not.toThrow();
    expect(() =>
      assertTicketNoShowAllowed({
        rotationState: "CALLED",
        calledAt: "2026-07-11T10:00:00.000Z",
        attendanceStatus: "NOT_CHECKED_IN",
        noShowAfterMinutes: 10,
        now: "2026-07-11T10:09:59.999Z",
      }),
    ).toThrowError(/Frist/);
    expect(() =>
      assertTicketNoShowAllowed({
        rotationState: "CALLED",
        calledAt: "2026-07-11T10:00:00.000Z",
        attendanceStatus: "CHECKED_IN",
        noShowAfterMinutes: 10,
        now: "2026-07-11T10:11:00.000Z",
      }),
    ).toThrowError(/anwesend/);
  });
});

describe("event parameter authorization", () => {
  it("is restricted to administration devices", () => {
    expect(() => assertRoleMayExecute("ADMIN", "CONFIGURE_EVENT_PARAMETERS")).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "CONFIGURE_EVENT_PARAMETERS")).toThrow();
  });
});

describe("master data authorization", () => {
  it("restricts product and gate changes to administration", () => {
    expect(() => assertRoleMayExecute("ADMIN", "UPSERT_PRODUCT")).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "UPSERT_GATE")).toThrow();
  });
});

describe("aircraft assignment authorization", () => {
  it("restricts assignments to administration", () => {
    expect(() => assertRoleMayExecute("ADMIN", "ASSIGN_AIRCRAFT_RESOURCE_GROUP")).not.toThrow();
    expect(() => assertRoleMayExecute("ADMIN", "DELETE_MASTER_DATA")).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "DELETE_MASTER_DATA")).toThrow(
      /darf DELETE_MASTER_DATA nicht ausführen/,
    );
    expect(() =>
      assertRoleMayExecute("FLIGHT_DIRECTOR", "ASSIGN_AIRCRAFT_RESOURCE_GROUP"),
    ).toThrow();
  });
});
