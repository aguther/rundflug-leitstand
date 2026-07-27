import { describe, expect, it } from "vitest";
import { plannedOperationAuditReason } from "./planned-operation-audit-reason";

describe("plannedOperationAuditReason", () => {
  it("describes creation by the administration", () => {
    expect(
      plannedOperationAuditReason({
        role: "ADMIN",
        action: "CREATE",
        kind: "PAUSE",
        scopeType: "EVENT",
      }),
    ).toBe("Administration: Pause für die gesamte Veranstaltung eingeplant.");
  });

  it("describes editing and cancellation by the flight director", () => {
    expect(
      plannedOperationAuditReason({
        role: "FLIGHT_DIRECTOR",
        action: "UPDATE",
        kind: "FLIGHT_SHOW",
        scopeType: "RESOURCE_GROUP",
      }),
    ).toBe("Flight Director: Flugshow für eine Ressourcengruppe bearbeitet.");
    expect(
      plannedOperationAuditReason({
        role: "FLIGHT_DIRECTOR",
        action: "CANCEL",
        kind: "TECHNICAL",
        scopeType: "AIRCRAFT",
      }),
    ).toBe("Flight Director: technische Unterbrechung für ein Flugzeug abgesagt.");
  });

  it("describes manually confirmed slowdown boundaries", () => {
    expect(
      plannedOperationAuditReason({
        role: "FLIGHT_DIRECTOR",
        action: "START",
        kind: "WEATHER",
        scopeType: "EVENT",
      }),
    ).toBe("Flight Director: Wetterunterbrechung für die gesamte Veranstaltung gestartet.");
    expect(
      plannedOperationAuditReason({
        role: "FLIGHT_DIRECTOR",
        action: "END",
        kind: "WEATHER",
        scopeType: "EVENT",
      }),
    ).toBe("Flight Director: Wetterunterbrechung für die gesamte Veranstaltung beendet.");
  });
});
