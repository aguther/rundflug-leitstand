import type { TicketSearchRequest } from "@rundflug/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizedDevice } from "./device-authorization";
import { registerTicketReadRoutes, type TicketReadRouteDependencies } from "./ticket-read-routes";
import {
  decodeTicketSearchCursor,
  loadTicketGroupPrintData,
  searchTicketGroups,
} from "./ticket-read-service";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440340";
const TICKET_GROUP_ID = "synthetic-ticket-group";

const cashierDevice: AuthorizedDevice = {
  id: "550e8400-e29b-41d4-a716-446655440341",
  role: "CASHIER",
  accountId: ACCOUNT_ID,
  loginCode: "CASHIER-01",
};

const printData = {
  ticketGroupId: TICKET_GROUP_ID,
  eventName: "Synthetic event",
  productName: "Synthetic product",
  gateLabel: "Gate A",
  communicationLabel: "G-PA-0042",
  code: "ABCDEFGHJKLM",
  groupSize: 3,
};

function createRouteApp(input?: { device?: AuthorizedDevice | null }) {
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: Object.create(null) as D1Database,
  }) as Env;
  const authorizeDevice = vi.fn(async () =>
    input && "device" in input ? (input.device ?? null) : cashierDevice,
  );
  const searchTicketGroupsMock = vi.fn(async () => ({
    ok: true as const,
    response: { results: [], nextCursor: null },
  }));
  const loadTicketGroupPrintDataMock = vi.fn(async () => ({
    status: "READY" as const,
    data: printData,
  }));
  const dependencies = {
    authorizeDevice,
    searchTicketGroups: searchTicketGroupsMock,
    loadTicketGroupPrintData: loadTicketGroupPrintDataMock,
  } as unknown as TicketReadRouteDependencies;
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  registerTicketReadRoutes(app as never, dependencies);
  return {
    app,
    env,
    authorizeDevice,
    searchTicketGroups: searchTicketGroupsMock,
    loadTicketGroupPrintData: loadTicketGroupPrintDataMock,
  };
}

function searchRequest(route: ReturnType<typeof createRouteApp>, query = "") {
  return route.app.request(
    `https://worker.test/api/control/${EVENT_ID}/tickets/search${query}`,
    undefined,
    route.env,
  );
}

function printRequest(route: ReturnType<typeof createRouteApp>) {
  return route.app.request(
    `https://worker.test/api/control/${EVENT_ID}/ticket-groups/${TICKET_GROUP_ID}/print-data`,
    undefined,
    route.env,
  );
}

function searchDatabase(rows: Array<Record<string, unknown>>) {
  let sql = "";
  let bindings: unknown[] = [];
  const all = vi.fn(async () => ({ results: rows }));
  const bind = vi.fn((...values: unknown[]) => {
    bindings = values;
    return { all };
  });
  const prepare = vi.fn((value: string) => {
    sql = value;
    return { bind };
  });
  return {
    database: { prepare } as unknown as D1Database,
    prepare,
    bind,
    all,
    sql: () => sql,
    bindings: () => bindings,
  };
}

function printDatabase(row: Record<string, unknown> | null) {
  let sql = "";
  const first = vi.fn(async () => row);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn((value: string) => {
    sql = value;
    return { bind };
  });
  return {
    database: { prepare } as unknown as D1Database,
    prepare,
    bind,
    first,
    sql: () => sql,
  };
}

function ticketSearchRequest(overrides: Partial<TicketSearchRequest> = {}): TicketSearchRequest {
  return {
    q: "",
    status: "ACTIVE",
    limit: 20,
    ticketGroupIds: [],
    ...overrides,
  };
}

const ticketRow = {
  ticket_group_id: TICKET_GROUP_ID,
  group_status: "OPEN",
  queue_sequence: 12,
  booking_group_number: 42,
  standby: 1,
  sold_at: "2026-08-09T10:00:00.000Z",
  sold_by_operator_account_id: ACCOUNT_ID,
  sold_by_operator_login_code: "CASHIER-01",
  product_id: "product-a",
  product_code: "PA",
  product_name: "Synthetic product",
  resource_group_short_code: "RG",
  group_size: 3,
  communication_numbers: "9,4",
  rotation_statuses: "BOARDING,CALLED",
};

describe("ticket read routes", () => {
  it.each([null, { ...cashierDevice, role: "DISPLAY" as const }])(
    "rejects ticket search for an unauthorized device",
    async (device) => {
      const route = createRouteApp({ device });
      const response = await searchRequest(route);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "SESSION_NOT_AUTHORIZED" },
      });
      expect(route.searchTicketGroups).not.toHaveBeenCalled();
    },
  );

  it.each(["CASHIER", "FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"] as const)(
    "allows ticket search for %s",
    async (role) => {
      const route = createRouteApp({ device: { ...cashierDevice, role } });
      const response = await searchRequest(route);
      expect(response.status).toBe(200);
      expect(route.searchTicketGroups).toHaveBeenCalledOnce();
    },
  );

  it("parses ticket filters and repeated IDs before calling the service", async () => {
    const route = createRouteApp();
    const response = await searchRequest(
      route,
      `?q=G-0042&status=OPEN&limit=12&id=group-a&id=group-b&soldByAccountId=${ACCOUNT_ID}`,
    );

    expect(response.status).toBe(200);
    expect(route.searchTicketGroups).toHaveBeenCalledWith(route.env.DB, EVENT_ID, {
      q: "G-0042",
      status: "OPEN",
      limit: 12,
      ticketGroupIds: ["group-a", "group-b"],
      soldByOperatorAccountId: ACCOUNT_ID,
    });
  });

  it("rejects invalid search input before calling the service", async () => {
    const route = createRouteApp();
    const response = await searchRequest(route, "?limit=0");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_TICKET_SEARCH" },
    });
    expect(route.searchTicketGroups).not.toHaveBeenCalled();
  });

  it("maps an invalid cursor from the service", async () => {
    const route = createRouteApp();
    route.searchTicketGroups.mockResolvedValueOnce({
      ok: false,
      code: "INVALID_TICKET_SEARCH_CURSOR",
    } as never);
    const response = await searchRequest(route, "?cursor=synthetic");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_TICKET_SEARCH_CURSOR" },
    });
  });

  it.each([null, { ...cashierDevice, role: "FLIGHT_LINE" as const }])(
    "rejects print data for an unauthorized device",
    async (device) => {
      const route = createRouteApp({ device });
      const response = await printRequest(route);
      expect(response.status).toBe(403);
      expect(route.loadTicketGroupPrintData).not.toHaveBeenCalled();
    },
  );

  it.each(["CASHIER", "ADMIN"] as const)("returns print data for %s", async (role) => {
    const route = createRouteApp({ device: { ...cashierDevice, role } });
    const response = await printRequest(route);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(printData);
    expect(route.loadTicketGroupPrintData).toHaveBeenCalledWith(
      route.env.DB,
      EVENT_ID,
      TICKET_GROUP_ID,
    );
  });

  it.each([
    ["NOT_FOUND", 404, "TICKET_GROUP_NOT_FOUND"],
    ["CANCELED", 409, "TICKET_GROUP_CANCELED"],
  ] as const)("maps print result %s to %s", async (status, expectedStatus, code) => {
    const route = createRouteApp();
    route.loadTicketGroupPrintData.mockResolvedValueOnce({ status } as never);
    const response = await printRequest(route);
    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });
});

describe("ticket read service", () => {
  it("returns no results for a one-character query without reading D1", async () => {
    const harness = searchDatabase([]);
    await expect(
      searchTicketGroups(harness.database, EVENT_ID, ticketSearchRequest({ q: "G" })),
    ).resolves.toEqual({ ok: true, response: { results: [], nextCursor: null } });
    expect(harness.prepare).not.toHaveBeenCalled();
  });

  it("rejects malformed cursors before reading D1", async () => {
    const harness = searchDatabase([]);
    await expect(
      searchTicketGroups(
        harness.database,
        EVENT_ID,
        ticketSearchRequest({ cursor: "not-a-cursor" }),
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_TICKET_SEARCH_CURSOR" });
    expect(harness.prepare).not.toHaveBeenCalled();
  });

  it("maps sorted communication data and preserves seller attribution", async () => {
    const harness = searchDatabase([ticketRow]);
    const result = await searchTicketGroups(harness.database, EVENT_ID, ticketSearchRequest());

    expect(result).toMatchObject({
      ok: true,
      response: {
        results: [
          {
            ticketGroupId: TICKET_GROUP_ID,
            bookingGroupLabel: "G-PA-0042",
            standby: true,
            soldByOperatorAccountId: ACCOUNT_ID,
            soldByOperatorLoginCode: "CASHIER-01",
            communicationNumbers: [4, 9],
            communicationLabels: ["F-RG-004", "F-RG-009"],
            rotationStatuses: ["BOARDING", "CALLED"],
          },
        ],
        nextCursor: null,
      },
    });
    expect(harness.sql()).toContain(
      "LEFT JOIN operator_accounts seller ON seller.id = tg.sold_by_operator_account_id",
    );
    expect(harness.sql()).not.toContain("seller.deleted_at IS NULL");
    expect(harness.sql()).toContain("tg.status <> 'CANCELED'");
    expect(harness.sql()).toContain("ORDER BY tg.sold_at DESC, tg.id DESC");
    expect(harness.bindings()).toEqual([EVENT_ID, 21]);
  });

  it("binds seller filters without excluding soft-deleted account labels", async () => {
    const harness = searchDatabase([]);
    await searchTicketGroups(
      harness.database,
      EVENT_ID,
      ticketSearchRequest({ soldByOperatorAccountId: ACCOUNT_ID }),
    );
    expect(harness.sql()).toContain("tg.sold_by_operator_account_id = ?2");
    expect(harness.sql()).not.toContain("seller.deleted_at IS NULL");
    expect(harness.bindings()).toEqual([EVENT_ID, ACCOUNT_ID, 21]);
  });

  it("returns a stable cursor for the final item on a truncated page", async () => {
    const harness = searchDatabase([
      ticketRow,
      { ...ticketRow, ticket_group_id: "older-group", sold_at: "2026-08-09T09:00:00.000Z" },
    ]);
    const result = await searchTicketGroups(
      harness.database,
      EVENT_ID,
      ticketSearchRequest({ limit: 1 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.results).toHaveLength(1);
    expect(decodeTicketSearchCursor(result.response.nextCursor ?? undefined)).toEqual({
      soldAt: ticketRow.sold_at,
      id: TICKET_GROUP_ID,
    });
    expect(harness.bindings()).toEqual([EVENT_ID, 2]);
  });

  it("uses bounded ID revalidation without cursor pagination", async () => {
    const harness = searchDatabase([ticketRow]);
    const result = await searchTicketGroups(
      harness.database,
      EVENT_ID,
      ticketSearchRequest({ ticketGroupIds: [TICKET_GROUP_ID] }),
    );
    expect(result).toMatchObject({ ok: true, response: { nextCursor: null } });
    expect(harness.sql()).toContain("tg.id IN (?2)");
    expect(harness.bindings()).toEqual([EVENT_ID, TICKET_GROUP_ID, 2]);
  });

  it("loads printable stored codes only for active groups", async () => {
    const ready = printDatabase({
      public_code: "ABCDEFGHJKLM",
      event_name: "Synthetic event",
      product_name: "Synthetic product",
      gate_label: "Gate A",
      product_code: "PA",
      communication_number: 42,
      group_status: "OPEN",
      group_size: 3,
    });
    await expect(
      loadTicketGroupPrintData(ready.database, EVENT_ID, TICKET_GROUP_ID),
    ).resolves.toEqual({ status: "READY", data: printData });
    expect(ready.sql()).toContain("COALESCE(tg.public_status_code");
    expect(ready.sql()).toContain("legacy.public_code");
    expect(ready.bind).toHaveBeenCalledWith(TICKET_GROUP_ID, EVENT_ID);

    const missing = printDatabase(null);
    await expect(
      loadTicketGroupPrintData(missing.database, EVENT_ID, TICKET_GROUP_ID),
    ).resolves.toEqual({ status: "NOT_FOUND" });

    const canceled = printDatabase({
      public_code: "ABCDEFGHJKLM",
      group_status: "CANCELED",
    });
    await expect(
      loadTicketGroupPrintData(canceled.database, EVENT_ID, TICKET_GROUP_ID),
    ).resolves.toEqual({ status: "CANCELED" });
  });
});
