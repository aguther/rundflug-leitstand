import { describe, expect, it, vi } from "vitest";
import { RotationRecoveryCommandService } from "./rotation-recovery-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
  first: () => Promise<unknown>;
  all: () => Promise<{ results: Array<Record<string, unknown>> }>;
}

function createDatabase(
  firstRows: unknown[] = [],
  allRows: Array<Array<Record<string, unknown>>> = [],
) {
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]): PreparedQuery => ({
      sql,
      parameters,
      first: async () => firstRows.shift() ?? null,
      all: async () => ({ results: allRows.shift() ?? [] }),
    }),
  }));
  const batch = vi.fn(async (statements: PreparedQuery[]) => statements);
  return { database: { prepare, batch } as unknown as D1Database, batch };
}

function event(): StoredEventRow {
  return {
    id: "event-a",
    name: "Synthetic event",
    event_date: "2026-08-12",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    operational_interrupted: 0,
    version: 7,
    operational_note: "",
    updated_at: "2026-08-12T08:00:00.000Z",
  };
}

const base = {
  commandId: "00e971df-23d5-4d28-9107-92b447416241",
  eventId: "event-a",
  deviceId: "device-a",
  expectedVersion: 7,
  issuedAt: "2026-08-12T08:00:00.000Z",
} as const;

function createService(database: D1Database) {
  const broadcast = vi.fn();
  return {
    service: new RotationRecoveryCommandService({ DB: database } as unknown as Env, broadcast),
    broadcast,
  };
}

describe("rotation recovery command service", () => {
  it("rejects technical aborts for missing, completed, unassigned, or stale rotations", async () => {
    const command = {
      ...base,
      type: "ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE" as const,
      payload: {
        rotationId: "rotation-a",
        expectedRotationVersion: 2,
        expectedAircraftVersion: 3,
        reason: "Synthetic technical abort",
      },
    };
    for (const [row, code, status] of [
      [null, "ROTATION_NOT_FOUND", 404],
      [
        {
          id: "rotation-a",
          status: "COMPLETED",
          version: 2,
          aircraft_id: "aircraft-a",
          aircraft_version: 3,
          flight_group_id: "group-a",
          resource_group_id: "resource-a",
        },
        "TECHNICAL_ROTATION_ABORT_NOT_ALLOWED",
        409,
      ],
      [
        {
          id: "rotation-a",
          status: "CALLED",
          version: 2,
          aircraft_id: null,
          aircraft_version: null,
          flight_group_id: "group-a",
          resource_group_id: "resource-a",
        },
        "AIRCRAFT_ASSIGNMENT_REQUIRED",
        409,
      ],
      [
        {
          id: "rotation-a",
          status: "CALLED",
          version: 4,
          aircraft_id: "aircraft-a",
          aircraft_version: 3,
          flight_group_id: "group-a",
          resource_group_id: "resource-a",
        },
        "STALE_AGGREGATE_VERSION",
        409,
      ],
    ] as const) {
      const input = createDatabase([row]);
      const response = await createService(input.database).service.handleTechnicalRotationAbort(
        command,
        event(),
      );
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
      expect(input.batch).not.toHaveBeenCalled();
    }
  });

  it("rejects technical abort when the rotation has no recoverable tickets", async () => {
    const input = createDatabase(
      [
        {
          id: "rotation-a",
          status: "IN_FLIGHT",
          version: 2,
          aircraft_id: "aircraft-a",
          aircraft_version: 3,
          pilot_id: "pilot-a",
          flight_group_id: "group-a",
          resource_group_id: "resource-a",
        },
      ],
      [[]],
    );
    const command = {
      ...base,
      type: "ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE" as const,
      payload: {
        rotationId: "rotation-a",
        expectedRotationVersion: 2,
        expectedAircraftVersion: 3,
        reason: "Synthetic technical abort",
      },
    };

    const response = await createService(input.database).service.handleTechnicalRotationAbort(
      command,
      event(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ROTATION_WITHOUT_TICKETS" },
    });
    expect(input.batch).not.toHaveBeenCalled();
  });

  it("applies a technical abort with queue restoration, audit, receipt and outbox", async () => {
    const input = createDatabase(
      [
        {
          id: "rotation-a",
          status: "IN_FLIGHT",
          version: 2,
          aircraft_id: "aircraft-a",
          aircraft_version: 3,
          pilot_id: "pilot-a",
          called_at: "2026-08-12T08:01:00.000Z",
          departed_at: "2026-08-12T08:05:00.000Z",
          landed_at: null,
          completed_at: null,
          flight_group_id: "group-a",
          resource_group_id: "resource-a",
        },
        { maximum_queue_sequence: 9 },
      ],
      [
        [
          {
            ticket_group_id: "ticket-group-b",
            queue_sequence: 5,
            assigned_at: "2026-08-12T07:59:00.000Z",
          },
          {
            ticket_group_id: "ticket-group-a",
            queue_sequence: 3,
            assigned_at: "2026-08-12T07:58:00.000Z",
          },
        ],
      ],
    );
    const { service, broadcast } = createService(input.database);
    const command = {
      ...base,
      type: "ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE" as const,
      payload: {
        rotationId: "rotation-a",
        expectedRotationVersion: 2,
        expectedAircraftVersion: 3,
        reason: "Synthetic technical abort",
      },
    };

    const response = await service.handleTechnicalRotationAbort(command, event());

    expect(response.status).toBe(200);
    expect(input.batch).toHaveBeenCalledOnce();
    const sql = (input.batch.mock.calls[0]?.[0] ?? []).map(({ sql }) => sql).join("\n");
    expect(sql).toContain("UPDATE aircraft SET operational_state = 'INACTIVE'");
    expect(sql).toContain("INSERT INTO operational_events");
    expect(sql).toContain("INSERT INTO idempotency_receipts");
    expect(sql).toContain("INSERT INTO outbox");
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("aborts only a called rotation and makes its aircraft available", async () => {
    const invalid = createDatabase([{ id: "rotation-a", status: "IN_FLIGHT" }]);
    const command = {
      ...base,
      type: "ABORT_ROTATION" as const,
      payload: { rotationId: "rotation-a", reason: "Synthetic abort" },
    };
    const invalidResponse = await createService(invalid.database).service.handleAbortRotation(
      command,
      event(),
    );
    expect(invalidResponse.status).toBe(409);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: { code: "ROTATION_ABORT_NOT_ALLOWED" },
    });

    const valid = createDatabase([
      {
        id: "rotation-a",
        status: "CALLED",
        version: 2,
        aircraft_id: "aircraft-a",
        flight_group_id: "group-a",
        resource_group_id: "resource-a",
        ticket_group_id: "ticket-group-a",
        product_id: "product-a",
      },
    ]);
    const result = createService(valid.database);
    const validResponse = await result.service.handleAbortRotation(command, event());
    expect(validResponse.status).toBe(200);
    const sql = (valid.batch.mock.calls[0]?.[0] ?? []).map(({ sql }) => sql).join("\n");
    expect(sql).toContain("operational_state = 'AVAILABLE'");
    expect(result.broadcast).toHaveBeenCalledOnce();
  });
});
