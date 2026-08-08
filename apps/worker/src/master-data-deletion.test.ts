import { commandEnvelopeSchema } from "@rundflug/contracts";
import { assertRoleMayExecute, DomainRuleError } from "@rundflug/domain";
import { describe, expect, it } from "vitest";

describe("F-ADM-050 master-data deletion safeguards", () => {
  const command = {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-admin",
    expectedVersion: 9,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "DELETE_MASTER_DATA" as const,
    payload: {
      entityType: "PRODUCT" as const,
      entityId: "product-one",
      reason: "Synthetic cleanup",
      adminPin: "1234",
    },
  };

  it("requires an administrator PIN and expected event version", () => {
    expect(commandEnvelopeSchema.parse(command)).toMatchObject({
      type: "DELETE_MASTER_DATA",
      expectedVersion: 9,
    });
    expect(() =>
      commandEnvelopeSchema.parse({
        ...command,
        payload: { ...command.payload, adminPin: "123" },
      }),
    ).toThrow();
  });

  it("allows only the administrator role to execute deletion", () => {
    expect(() => assertRoleMayExecute("ADMIN", "DELETE_MASTER_DATA")).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "DELETE_MASTER_DATA")).toThrow(
      DomainRuleError,
    );
  });
});
