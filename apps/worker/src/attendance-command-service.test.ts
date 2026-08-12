import type { CommandEnvelope } from "@rundflug/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceCommandService } from "./attendance-command-service";
import type { StoredTicketGroupRecall } from "./ticket-group-recall-persistence-service";
import type { Env, StoredEventRow } from "./types";
import { sendTicketGroupRecallPushNotifications } from "./web-push";

vi.mock("./web-push", () => ({
  sendTicketGroupRecallPushNotifications: vi.fn(async () => undefined),
}));

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type AttendanceCommand = Extract<
  CommandEnvelope,
  {
    type:
      | "SET_TICKET_ATTENDANCE"
      | "SET_TICKET_GROUP_ATTENDANCE"
      | "START_TICKET_GROUP_RECALL"
      | "CLEAR_TICKET_GROUP_RECALL"
      | "MARK_TICKET_GROUP_MISSING"
      | "RESTORE_TICKET_GROUP_TO_QUEUE"
      | "RECALL_TICKET_GROUP"
      | "MARK_TICKET_NO_SHOW"
      | "CONFIRM_ATTENDANCE_DECISION";
  }
>;

function createDatabase(firstResults: Array<Record<string, unknown> | null>) {
  const batches: PreparedQuery[][] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => ({
      sql,
      parameters,
      first: async () => firstResults.shift() ?? null,
    }),
  }));
  const batch = vi.fn(async (statements: PreparedQuery[]) => {
    batches.push(statements);
    return statements.map(() => ({ success: true, results: [], meta: {} }));
  });
  return { db: { prepare, batch } as unknown as D1Database, batches };
}

function currentEvent(overrides: Partial<StoredEventRow> = {}): StoredEventRow {
  return {
    id: "synthetic-event",
    name: "Synthetic event",
    event_date: "2026-08-08",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    version: 11,
    operational_note: "",
    no_show_after_minutes: 10,
    updated_at: "2026-08-08T08:00:00.000Z",
    ...overrides,
  };
}

function command<T extends AttendanceCommand["type"]>(
  type: T,
  payload: Extract<AttendanceCommand, { type: T }>["payload"],
): Extract<AttendanceCommand, { type: T }> {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-device",
    expectedVersion: 11,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type,
    payload,
  } as Extract<AttendanceCommand, { type: T }>;
}

function createService(input: { db: D1Database; recalls?: StoredTicketGroupRecall[] }) {
  const broadcast = vi.fn();
  const waitUntil = vi.fn();
  const loadRecalls = vi.fn(async () => input.recalls ?? []);
  const closureStatement = {
    sql: "UPDATE ticket_group_recalls SET ended_at",
    parameters: [],
  } as unknown as D1PreparedStatement;
  const closeRecalls = vi.fn(() => [closureStatement]);
  return {
    service: new AttendanceCommandService(
      { DB: input.db } as unknown as Env,
      broadcast,
      waitUntil,
      loadRecalls,
      closeRecalls,
    ),
    broadcast,
    waitUntil,
    loadRecalls,
    closeRecalls,
    closureStatement,
  };
}

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

describe("attendance command service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unknown ticket without persistence", async () => {
    const { db, batches } = createDatabase([null]);
    const { service } = createService({ db });

    const response = await service.handleTicketAttendance(
      command("SET_TICKET_ATTENDANCE", { ticketId: "ticket-one", checkedIn: true }),
      currentEvent(),
    );

    await expectError(response, 404, "TICKET_NOT_FOUND");
    expect(batches).toHaveLength(0);
  });

  it("rejects ticket attendance changes after departure", async () => {
    const { db, batches } = createDatabase([
      {
        id: "ticket-one",
        status: "IN_FLIGHT",
        attendance_status: "CHECKED_IN",
        rotation_status: "IN_FLIGHT",
      },
    ]);
    const { service } = createService({ db });

    const response = await service.handleTicketAttendance(
      command("SET_TICKET_ATTENDANCE", { ticketId: "ticket-one", checkedIn: false }),
      currentEvent(),
    );

    await expectError(response, 409, "ATTENDANCE_LOCKED");
    expect(batches).toHaveLength(0);
  });

  it.each([
    [true, "CALLED", "CHECKED_IN", "BOARDING", "TICKET_CHECKED_IN"],
    [false, "DRAFT", "NOT_CHECKED_IN", "QUEUED", "TICKET_CHECK_IN_REVOKED"],
  ] as const)(
    "persists a ticket attendance transition checkedIn=%s",
    async (checkedIn, rotationStatus, attendance, ticketStatus, eventType) => {
      const { db, batches } = createDatabase([
        {
          id: "ticket-one",
          status: checkedIn ? "CALLED" : "CHECKED_IN",
          attendance_status: checkedIn ? "NOT_CHECKED_IN" : "CHECKED_IN",
          rotation_status: rotationStatus,
        },
      ]);
      const { service, broadcast } = createService({ db });

      const response = await service.handleTicketAttendance(
        command("SET_TICKET_ATTENDANCE", { ticketId: "ticket-one", checkedIn }),
        currentEvent(),
      );

      await expect(response.json()).resolves.toMatchObject({ accepted: true, eventType });
      expect(broadcast).toHaveBeenCalledOnce();
      expect(findStatement(batches[0] ?? [], "UPDATE tickets SET").parameters.slice(0, 2)).toEqual([
        attendance,
        ticketStatus,
      ]);
    },
  );

  it("checks in a complete group and closes its active recall atomically", async () => {
    const recall = {
      id: "recall-one",
      ticket_group_id: "group-one",
      sequence: 2,
      started_at: "2026-08-08T07:30:00.000Z",
      expires_at: "2099-08-08T07:35:00.000Z",
    } satisfies StoredTicketGroupRecall;
    const { db, batches } = createDatabase([
      { id: "group-one", status: "QUEUED", version: 4, rotation_status: "CALLED" },
    ]);
    const context = createService({ db, recalls: [recall] });

    const response = await context.service.handleTicketGroupAttendance(
      command("SET_TICKET_GROUP_ATTENDANCE", { ticketGroupId: "group-one", checkedIn: true }),
      currentEvent(),
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "TICKET_GROUP_CHECKED_IN",
    });
    expect(context.loadRecalls).toHaveBeenCalledWith(
      "synthetic-event",
      ["group-one"],
      expect.any(String),
    );
    expect(context.closeRecalls).toHaveBeenCalledWith(
      expect.objectContaining({ recalls: [recall], reason: "PRESENT" }),
    );
    expect(batches[0]).toContain(context.closureStatement);
    expect(findStatement(batches[0] ?? [], "UPDATE tickets SET").parameters.slice(0, 2)).toEqual([
      "CHECKED_IN",
      "BOARDING",
    ]);
  });

  it("revokes group attendance without closing recalls", async () => {
    const { db, batches } = createDatabase([
      { id: "group-one", status: "PRESENT", version: 4, rotation_status: "DRAFT" },
    ]);
    const context = createService({ db });

    const response = await context.service.handleTicketGroupAttendance(
      command("SET_TICKET_GROUP_ATTENDANCE", { ticketGroupId: "group-one", checkedIn: false }),
      currentEvent(),
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "TICKET_GROUP_CHECK_IN_REVOKED",
    });
    expect(context.loadRecalls).not.toHaveBeenCalled();
    expect(findStatement(batches[0] ?? [], "UPDATE tickets SET").parameters.slice(0, 2)).toEqual([
      "NOT_CHECKED_IN",
      "QUEUED",
    ]);
  });

  it("rejects clearing an inactive or stale recall", async () => {
    const activeRecall = {
      id: "550e8400-e29b-41d4-a716-446655440099",
      ticket_group_id: "group-one",
      sequence: 1,
      started_at: "2026-08-08T07:30:00.000Z",
      expires_at: "2099-08-08T07:35:00.000Z",
    } satisfies StoredTicketGroupRecall;
    for (const [recalls, code] of [
      [[], "TICKET_GROUP_RECALL_NOT_ACTIVE"],
      [[activeRecall], "TICKET_GROUP_RECALL_STALE"],
    ] as const) {
      const { db, batches } = createDatabase([
        { id: "group-one", status: "QUEUED", gate_label: "Gate 1", recall_count: 1 },
      ]);
      const { service } = createService({ db, recalls: [...recalls] });
      const response = await service.handleTicketGroupRecall(
        command("CLEAR_TICKET_GROUP_RECALL", {
          ticketGroupId: "group-one",
          recallId: "550e8400-e29b-41d4-a716-446655440098",
        }),
        currentEvent(),
      );
      await expectError(response, 409, code);
      expect(batches).toHaveLength(0);
    }
  });

  it("clears the matching active recall through the shared closure statements", async () => {
    const recall = {
      id: "550e8400-e29b-41d4-a716-446655440099",
      ticket_group_id: "group-one",
      sequence: 1,
      started_at: "2026-08-08T07:30:00.000Z",
      expires_at: "2099-08-08T07:35:00.000Z",
    } satisfies StoredTicketGroupRecall;
    const { db, batches } = createDatabase([
      { id: "group-one", status: "QUEUED", gate_label: "Gate 1", recall_count: 1 },
    ]);
    const context = createService({ db, recalls: [recall] });

    const response = await context.service.handleTicketGroupRecall(
      command("CLEAR_TICKET_GROUP_RECALL", {
        ticketGroupId: "group-one",
        recallId: recall.id,
      }),
      currentEvent(),
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "TICKET_GROUP_RECALL_CLEARED",
    });
    expect(context.closeRecalls).toHaveBeenCalledWith(
      expect.objectContaining({ recalls: [recall], reason: "MANUAL" }),
    );
    expect(batches[0]).toContain(context.closureStatement);
  });

  it("starts a recall, expires an old record, and schedules public notifications", async () => {
    const expiredRecall = {
      id: "recall-expired",
      ticket_group_id: "group-one",
      sequence: 1,
      started_at: "2020-08-08T07:30:00.000Z",
      expires_at: "2020-08-08T07:35:00.000Z",
    } satisfies StoredTicketGroupRecall;
    const { db, batches } = createDatabase([
      { id: "group-one", status: "QUEUED", gate_label: "Gate 1", recall_count: 1 },
    ]);
    const context = createService({ db, recalls: [expiredRecall] });

    const response = await context.service.handleTicketGroupRecall(
      command("START_TICKET_GROUP_RECALL", { ticketGroupId: "group-one" }),
      currentEvent(),
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "TICKET_GROUP_RECALL_STARTED",
    });
    expect(context.closeRecalls).toHaveBeenCalledWith(
      expect.objectContaining({ recalls: [expiredRecall], reason: "EXPIRED", deviceId: "SYSTEM" }),
    );
    expect(sendTicketGroupRecallPushNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ DB: db }),
      expect.any(String),
    );
    expect(context.waitUntil).toHaveBeenCalledOnce();
    expect(findStatement(batches[0] ?? [], "INSERT INTO ticket_group_recalls")).toBeDefined();
  });

  it("rejects recall starts outside an active event", async () => {
    const { db, batches } = createDatabase([
      { id: "group-one", status: "QUEUED", gate_label: "Gate 1", recall_count: 0 },
    ]);
    const { service } = createService({ db });

    const response = await service.handleTicketGroupRecall(
      command("START_TICKET_GROUP_RECALL", { ticketGroupId: "group-one" }),
      currentEvent({ status: "CLOSED" }),
    );

    await expectError(response, 409, "TICKET_GROUP_RECALL_EVENT_NOT_ACTIVE");
    expect(batches).toHaveLength(0);
  });

  it.each([
    ["MARK_TICKET_GROUP_MISSING", "QUEUED", "TICKET_GROUP_MARKED_MISSING", "MISSING"],
    ["RESTORE_TICKET_GROUP_TO_QUEUE", "MISSING", "TICKET_GROUP_RESTORED_TO_QUEUE", "QUEUED"],
    ["RECALL_TICKET_GROUP", "MISSING", "TICKET_GROUP_RESTORED_TO_QUEUE", "QUEUED"],
  ] as const)(
    "persists %s as an explicit group state transition",
    async (type, status, eventType, persistedStatus) => {
      const { db, batches } = createDatabase([{ id: "group-one", status, version: 3 }]);
      const { service } = createService({ db });
      const payload =
        type === "MARK_TICKET_GROUP_MISSING"
          ? { ticketGroupId: "group-one", reason: "Synthetic absence" }
          : { ticketGroupId: "group-one" };

      const response = await service.handleTicketGroupPresence(
        command(type, payload),
        currentEvent(),
      );

      await expect(response.json()).resolves.toMatchObject({ accepted: true, eventType });
      const update = findStatement(batches[0] ?? [], "UPDATE ticket_groups SET status");
      expect(update.sql).toContain(`status = '${persistedStatus}'`);
    },
  );

  it("rejects restoring a group that is not missing", async () => {
    const { db, batches } = createDatabase([{ id: "group-one", status: "PRESENT", version: 3 }]);
    const { service } = createService({ db });

    const response = await service.handleTicketGroupPresence(
      command("RESTORE_TICKET_GROUP_TO_QUEUE", { ticketGroupId: "group-one" }),
      currentEvent(),
    );

    await expectError(response, 409, "TICKET_GROUP_NOT_MISSING");
    expect(batches).toHaveLength(0);
  });

  it("rejects a no-show before the configured deadline", async () => {
    const { db, batches } = createDatabase([
      {
        id: "ticket-one",
        ticket_group_id: "group-one",
        attendance_status: "NOT_CHECKED_IN",
        group_version: 3,
        rotation_id: "rotation-one",
        rotation_status: "CALLED",
        called_at: new Date().toISOString(),
        aircraft_id: "aircraft-one",
        remaining_group_tickets: 1,
        remaining_rotation_tickets: 1,
      },
    ]);
    const { service } = createService({ db });

    const response = await service.handleAttendanceException(
      command("MARK_TICKET_NO_SHOW", { ticketId: "ticket-one", reason: "Synthetic absence" }),
      currentEvent(),
    );

    await expectError(response, 409, "NO_SHOW_DEADLINE_NOT_REACHED");
    expect(batches).toHaveLength(0);
  });

  it("releases a no-show and cancels an emptied rotation without splitting the group", async () => {
    const recall = {
      id: "recall-one",
      ticket_group_id: "group-one",
      sequence: 1,
      started_at: "2026-08-08T07:00:00.000Z",
      expires_at: "2099-08-08T07:35:00.000Z",
    } satisfies StoredTicketGroupRecall;
    const { db, batches } = createDatabase([
      {
        id: "ticket-one",
        ticket_group_id: "group-one",
        attendance_status: "NOT_CHECKED_IN",
        group_version: 3,
        rotation_id: "rotation-one",
        rotation_status: "CALLED",
        called_at: "2020-08-08T07:00:00.000Z",
        aircraft_id: "aircraft-one",
        remaining_group_tickets: 0,
        remaining_rotation_tickets: 0,
      },
    ]);
    const context = createService({ db, recalls: [recall] });

    const response = await context.service.handleAttendanceException(
      command("MARK_TICKET_NO_SHOW", { ticketId: "ticket-one", reason: "Synthetic absence" }),
      currentEvent(),
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "TICKET_NO_SHOW",
    });
    const batch = batches[0] ?? [];
    expect(findStatement(batch, "UPDATE rotation_tickets SET released_at")).toBeDefined();
    expect(findStatement(batch, "UPDATE ticket_groups SET status = 'NO_SHOW'")).toBeDefined();
    expect(findStatement(batch, "UPDATE rotations SET status = 'CANCELED'")).toBeDefined();
    expect(
      findStatement(batch, "UPDATE aircraft SET operational_state = 'AVAILABLE'"),
    ).toBeDefined();
    expect(batch).toContain(context.closureStatement);
  });

  it.each([
    [
      {
        id: "rotation-one",
        status: "DRAFT",
        ticket_count: 2,
        present_count: 1,
        latest_decision_payload: null,
      },
      "ATTENDANCE_DECISION_NOT_REQUIRED",
    ],
    [
      {
        id: "rotation-one",
        status: "CALLED",
        ticket_count: 2,
        present_count: 1,
        latest_decision_payload: JSON.stringify({ presentCount: 1, missingCount: 1 }),
      },
      "ATTENDANCE_DECISION_ALREADY_CONFIRMED",
    ],
  ] as const)("rejects an inapplicable attendance decision", async (rotation, code) => {
    const { db, batches } = createDatabase([rotation]);
    const { service } = createService({ db });

    const response = await service.handleAttendanceException(
      command("CONFIRM_ATTENDANCE_DECISION", {
        rotationId: "rotation-one",
        decision: "FLY_WITH_PRESENT",
      }),
      currentEvent(),
    );

    await expectError(response, 409, code);
    expect(batches).toHaveLength(0);
  });

  it("records the human attendance decision without automatic replacement", async () => {
    const { db, batches } = createDatabase([
      {
        id: "rotation-one",
        status: "CALLED",
        ticket_count: 3,
        present_count: 2,
        latest_decision_payload: null,
      },
    ]);
    const { service, broadcast } = createService({ db });

    const response = await service.handleAttendanceException(
      command("CONFIRM_ATTENDANCE_DECISION", {
        rotationId: "rotation-one",
        decision: "LEAVE_SEAT_EMPTY",
      }),
      currentEvent(),
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "ATTENDANCE_EMPTY_SEAT_CONFIRMED",
    });
    const eventStatement = findStatement(batches[0] ?? [], "INSERT INTO operational_events");
    expect(JSON.parse(String(eventStatement.parameters.at(-1)))).toEqual({
      decision: "LEAVE_SEAT_EMPTY",
      presentCount: 2,
      missingCount: 1,
      automaticReplacement: false,
    });
    expect(broadcast).toHaveBeenCalledOnce();
  });
});
