import type { CommandEnvelope } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import { createEventCommandHandlers, type EventCommandServices } from "./event-command-handlers";
import type { StoredEventRow } from "./types";

const commandServiceProperties = [
  "attendanceCommands",
  "eventAdministrationCommands",
  "fleetAdministrationCommands",
  "masterDataCommands",
  "operationalControlCommands",
  "operationalNoteCommands",
  "outageRecoveryCommands",
  "pilotAssignmentCommands",
  "plannedOperationCommands",
  "productSalesCommands",
  "recurringOperationalRuleCommands",
  "rotationCorrectionCommands",
  "rotationNoteCommands",
  "rotationRecoveryCommands",
  "rotationTransitionCommands",
  "ticketGroupMutationCommands",
  "ticketSalesCommands",
] as const;

function currentEvent(): StoredEventRow {
  return {
    id: "synthetic-event",
    name: "Synthetic event",
    event_date: "2026-08-11",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    operational_interrupted: 0,
    operations_end_at: "2026-08-11T18:00:00.000Z",
    version: 9,
    operational_note: "",
    updated_at: "2026-08-11T10:00:00.000Z",
  };
}

describe("event coordinator command registry", () => {
  it("routes every registered command type through exactly one family handler", async () => {
    const routedTypes: string[] = [];
    const service = new Proxy(
      {},
      {
        get: () => async (command: CommandEnvelope) => {
          routedTypes.push(command.type);
          return new Response(null, { status: 204 });
        },
      },
    );
    const services = Object.fromEntries(
      commandServiceProperties.map((property) => [property, service]),
    ) as unknown as EventCommandServices;
    const registry = createEventCommandHandlers(
      services,
      currentEvent(),
      "synthetic-operator",
      "ADMIN",
    );
    const entries = Object.entries(registry);
    for (const [type, entry] of entries) {
      const response = await entry.handle({ type } as never);
      expect(response.status).toBe(204);
    }

    expect(routedTypes).toEqual(entries.map(([type]) => type));
    expect(new Set(entries.map(([, entry]) => entry.family))).toEqual(
      new Set([
        "attendance",
        "event-administration",
        "fleet-administration",
        "master-data",
        "operational-control",
        "operational-note",
        "outage-recovery",
        "pilot-assignment",
        "planned-operations",
        "product-sales",
        "recurring-operational-rules",
        "rotation-correction",
        "rotation-recovery",
        "rotation-transition",
        "ticket-group-mutation",
      ]),
    );
  });
});
