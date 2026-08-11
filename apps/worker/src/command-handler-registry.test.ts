import type { CommandEnvelope } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  defineCommandHandlerRegistry,
  dispatchRegisteredCommand,
} from "./command-handler-registry";

describe("command handler registry", () => {
  it("dispatches a command only to its registered typed handler", async () => {
    type TestCommand = Extract<CommandEnvelope, { type: "SET_OPERATIONAL_NOTE" }>;
    const command = {
      type: "SET_OPERATIONAL_NOTE",
      commandId: "3e706d2f-7864-48db-a38d-dd843d232c41",
      eventId: "synthetic-event",
      deviceId: "synthetic-device",
      expectedVersion: 4,
      issuedAt: "2026-08-11T10:00:00.000Z",
      payload: { note: "Synthetic note" },
    } satisfies TestCommand;
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const registry = defineCommandHandlerRegistry<TestCommand>({
      SET_OPERATIONAL_NOTE: { family: "operational-note", handle: handler },
    });

    const response = await dispatchRegisteredCommand(registry, command);

    expect(response.status).toBe(204);
    expect(handler).toHaveBeenCalledExactlyOnceWith(command);
  });
});
