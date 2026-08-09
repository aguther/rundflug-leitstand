import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import { registerPublicStatusRoutes } from "./public-status-routes";
import type { Env } from "./types";

const NOW = "2026-08-09T08:00:00.000Z";

function createApp(input?: {
  ticketRow?: Record<string, unknown> | null;
  groupRow?: Record<string, unknown> | null;
  rotationRows?: Record<string, unknown>[];
}) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => {
      statements.push({ sql, bindings });
      return {
        first: async () => {
          if (sql.includes("WHERE t.public_code_hash")) return input?.ticketRow ?? null;
          if (sql.includes("WHERE tg.public_status_code_hash")) return input?.groupRow ?? null;
          return null;
        },
        all: async () => ({ results: input?.rotationRows ?? [] }),
      };
    },
  }));
  const unknownTicketResponse = vi.fn(async () =>
    Response.json(
      { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
      { status: 404, headers: { "cache-control": "no-store" } },
    ),
  );
  const env = { DB: { prepare } } as unknown as Env;
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerPublicStatusRoutes(app, unknownTicketResponse);
  return { app, env, prepare, statements, unknownTicketResponse };
}

function recallColumns() {
  return {
    recall_id: "recall-1",
    recall_sequence: 2,
    recall_started_at: "2026-08-09T07:58:00.000Z",
    recall_expires_at: "2026-08-09T08:03:00.000Z",
  };
}

function ticketRow() {
  return {
    product_name: "Panorama",
    product_code: "PAN20",
    public_description: "Synthetischer Rundflug",
    gate_label: "Gate 2",
    communication_number: 8021,
    part_number: 1,
    part_count: 2,
    passenger_count: 3,
    precalled_at: null,
    precall_decision_status: "PREPARE",
    status: "DRAFT",
    operation_day_id: "event-1",
    queue_sequence: 2,
    predicted_boarding_at: "2026-08-09T08:30:00.000Z",
    predicted_completion_at: "2026-08-09T08:50:00.000Z",
    prediction_quality: "STABLE",
    prediction_lower_minutes: 20,
    prediction_upper_minutes: 40,
    prediction_updated_at: NOW,
    dispatch_batch_id: "batch-1",
    dispatch_unplanned_reason: null,
    updated_at: NOW,
    event_name: "Synthetischer Flugtag",
    time_zone: "Europe/Berlin",
    event_operational_note: "Allgemeiner Hinweis",
    resource_group_operational_note: "Ressourcenhinweis",
    planned_public_note: "Planhinweis",
    operational_interrupted: 0,
    emergency_mode: 0,
    notification_lead_minutes: 15,
    operations_end_at: "2026-08-09T18:00:00.000Z",
    resource_group_status: "ACTIVE",
    ...recallColumns(),
  };
}

function groupRow() {
  return {
    id: "group-1",
    communication_number: 8021,
    operation_day_id: "event-1",
    product_name: "Panorama",
    product_code: "PAN20",
    public_description: "Synthetischer Rundflug",
    gate_label: "Gate 2",
    event_name: "Synthetischer Flugtag",
    time_zone: "Europe/Berlin",
    event_operational_note: "Allgemeiner Hinweis",
    operational_interrupted: 0,
    emergency_mode: 0,
    notification_lead_minutes: 15,
    operations_end_at: "2026-08-09T18:00:00.000Z",
    updated_at: NOW,
    resource_group_status: "ACTIVE",
    resource_group_operational_note: "Ressourcenhinweis",
    planned_public_note: "Planhinweis",
    group_size: 5,
    ...recallColumns(),
  };
}

function rotationRows() {
  return [
    {
      id: "rotation-1",
      status: "DRAFT",
      predicted_boarding_at: "2026-08-09T08:30:00.000Z",
      predicted_completion_at: "2026-08-09T08:50:00.000Z",
      prediction_quality: "STABLE",
      prediction_lower_minutes: 20,
      prediction_upper_minutes: 40,
      prediction_updated_at: NOW,
      dispatch_batch_id: "batch-1",
      dispatch_unplanned_reason: null,
      precalled_at: null,
      precall_decision_status: "PREPARE",
      queue_position: 2,
      gate_label: "Gate 2",
      part_number: 1,
      part_count: 2,
      passenger_count: 3,
    },
    {
      id: "rotation-2",
      status: "CALLED",
      predicted_boarding_at: null,
      predicted_completion_at: null,
      prediction_quality: "CHANGING",
      prediction_lower_minutes: null,
      prediction_upper_minutes: null,
      prediction_updated_at: NOW,
      dispatch_batch_id: null,
      dispatch_unplanned_reason: null,
      precalled_at: "2026-08-09T07:55:00.000Z",
      precall_decision_status: "GO_TO_GATE",
      queue_position: 3,
      gate_label: "Gate 3",
      part_number: 2,
      part_count: 2,
      passenger_count: 2,
    },
  ];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("public ticket and group status routes", () => {
  it.each(["tickets", "groups"])("rejects an invalid %s code without querying D1", async (kind) => {
    const { app, env, prepare, unknownTicketResponse } = createApp();

    const response = await app.request(`https://worker.test/api/public/${kind}/invalid`, {}, env);

    expect(response.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
    expect(unknownTicketResponse).toHaveBeenCalledOnce();
  });

  it("projects a ticket status with its part, forecast, notice, and recall", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, statements } = createApp({ ticketRow: ticketRow() });

    const response = await app.request(
      "https://worker.test/api/public/tickets/ABCD2345EFGH",
      {},
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      eventId: "event-1",
      productCode: "PAN20",
      communicationNumber: 8021,
      bookingGroupPart: { partNumber: 1, partCount: 2, passengerCount: 3 },
      status: "PREPARE",
      queuePosition: 2,
      waitLowerMinutes: 20,
      waitUpperMinutes: 40,
      boardingWindowLowerAt: "2026-08-09T08:20:00.000Z",
      boardingWindowUpperAt: "2026-08-09T08:40:00.000Z",
      forecastState: "DISPATCH_WINDOW",
      forecastReason: null,
      predictionQuality: "STABLE",
      message: "Ihr Aufruf steht bevor. Bitte halten Sie sich in der Nähe des Gates bereit.",
      operationalNotice: "Planhinweis",
      activeRecall: {
        id: "recall-1",
        sequence: 2,
        publicMessage:
          "Ihre Gruppe wird erneut aufgerufen. Bitte kommen Sie jetzt sofort zu Gate 2.",
      },
      updatedAt: NOW,
    });
    expect(payload).not.toHaveProperty("reason");
    expect(payload).not.toHaveProperty("publicOperationalPlanReason");
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toContain("WITH relevant_booking_group_rotations AS");
    expect(statements[0]?.bindings[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(statements[0]?.bindings[1]).toBe(NOW);
  });

  it("derives ticket boarding from the called rotation state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env } = createApp({
      ticketRow: {
        ...ticketRow(),
        status: "CALLED",
        precalled_at: "2026-08-09T07:55:00.000Z",
        precall_decision_status: "GO_TO_GATE",
      },
    });

    const response = await app.request(
      "https://worker.test/api/public/tickets/ABCD2345EFGH",
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "BOARDING",
      queuePosition: null,
      message: "Das Boarding hat begonnen. Bitte halten Sie Ihr Ticket für den Einstieg bereit.",
    });
  });

  it("withholds a stale ticket forecast using the persisted prediction timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env } = createApp({
      ticketRow: {
        ...ticketRow(),
        prediction_updated_at: "2026-08-09T07:54:59.999Z",
      },
    });

    const response = await app.request(
      "https://worker.test/api/public/tickets/ABCD2345EFGH",
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "WAITING",
      predictionQuality: "UNCERTAIN",
      boardingWindowLowerAt: null,
      boardingWindowUpperAt: null,
      message: "Prognose wird aktualisiert – bitte Status erneut prüfen.",
    });
  });

  it("projects all canonical parts for a booking group", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, statements } = createApp({
      groupRow: groupRow(),
      rotationRows: rotationRows(),
    });

    const response = await app.request(
      "https://worker.test/api/public/groups/ABCD2345EFGH",
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      eventId: "event-1",
      bookingGroupLabel: "G-PAN20-8021",
      groupSize: 5,
      operationalNotice: "Planhinweis",
      activeRecall: { id: "recall-1", sequence: 2 },
      parts: [
        {
          partNumber: 1,
          partCount: 2,
          passengerCount: 3,
          gateLabel: "Gate 2",
          status: "PREPARE",
          queuePosition: 2,
          forecastState: "DISPATCH_WINDOW",
        },
        {
          partNumber: 2,
          partCount: 2,
          passengerCount: 2,
          gateLabel: "Gate 3",
          status: "BOARDING",
          queuePosition: null,
          forecastState: "UNAVAILABLE",
        },
      ],
    });
    expect(statements).toHaveLength(2);
    expect(statements[1]?.sql).toContain("WHERE part.ticket_group_id = ?1");
    expect(statements[1]?.bindings).toEqual(["group-1"]);
  });

  it("applies the same service pause status and message to tickets and groups", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const pausedTicket = createApp({
      ticketRow: { ...ticketRow(), resource_group_status: "PAUSED" },
    });
    const pausedGroup = createApp({
      groupRow: { ...groupRow(), resource_group_status: "PAUSED" },
      rotationRows: rotationRows(),
    });

    const [ticketResponse, groupResponse] = await Promise.all([
      pausedTicket.app.request(
        "https://worker.test/api/public/tickets/ABCD2345EFGH",
        {},
        pausedTicket.env,
      ),
      pausedGroup.app.request(
        "https://worker.test/api/public/groups/ABCD2345EFGH",
        {},
        pausedGroup.env,
      ),
    ]);

    await expect(ticketResponse.json()).resolves.toMatchObject({
      status: "SERVICE_PAUSED",
      message: "Flugbetrieb für dieses Produkt pausiert – bitte Status erneut prüfen.",
    });
    const groupPayload = (await groupResponse.json()) as { parts: Array<Record<string, unknown>> };
    expect(groupPayload.parts).toHaveLength(2);
    expect(groupPayload.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "SERVICE_PAUSED",
          message: "Flugbetrieb für dieses Produkt pausiert – bitte Status erneut prüfen.",
        }),
      ]),
    );
  });

  it("uses the existing unknown response when a group has no active parts", async () => {
    const { app, env, unknownTicketResponse } = createApp({
      groupRow: groupRow(),
      rotationRows: [],
    });

    const response = await app.request(
      "https://worker.test/api/public/groups/ABCD2345EFGH",
      {},
      env,
    );

    expect(response.status).toBe(404);
    expect(unknownTicketResponse).toHaveBeenCalledOnce();
  });
});
