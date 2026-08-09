import type {
  TicketGroupPrintData,
  TicketSearchRequest,
  TicketSearchResponse,
} from "@rundflug/contracts";
import { formatBookingGroupLabel, formatFlightGroupLabel } from "@rundflug/domain";
import { sha256Hex } from "./crypto";
import { ticketSearchStatusCondition } from "./ticket-search";

interface TicketSearchCursor {
  soldAt: string;
  id: string;
}

interface TicketSearchRow {
  ticket_group_id: string;
  group_status: string;
  queue_sequence: number;
  booking_group_number: number;
  standby: number;
  sold_at: string;
  sold_by_operator_account_id: string | null;
  sold_by_operator_login_code: string | null;
  product_id: string;
  product_code: string;
  product_name: string;
  resource_group_short_code: string;
  group_size: number;
  communication_numbers: string | null;
  rotation_statuses: string | null;
}

interface TicketGroupPrintRow {
  public_code: string | null;
  event_name: string;
  product_name: string;
  gate_label: string;
  product_code: string;
  communication_number: number;
  group_status: string;
  group_size: number;
}

export type TicketSearchServiceResult =
  | { ok: true; response: TicketSearchResponse }
  | { ok: false; code: "INVALID_TICKET_SEARCH_CURSOR" };

export type TicketGroupPrintResult =
  | { status: "READY"; data: TicketGroupPrintData }
  | { status: "NOT_FOUND" }
  | { status: "CANCELED" };

export function encodeTicketSearchCursor(cursor: TicketSearchCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeTicketSearchCursor(value: string | undefined): TicketSearchCursor | null {
  if (!value) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as {
      soldAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.soldAt !== "string" ||
      Number.isNaN(Date.parse(parsed.soldAt)) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      parsed.id.length > 100
    ) {
      return null;
    }
    return { soldAt: parsed.soldAt, id: parsed.id };
  } catch {
    return null;
  }
}

export async function searchTicketGroups(
  database: D1Database,
  eventId: string,
  request: TicketSearchRequest,
): Promise<TicketSearchServiceResult> {
  const rawQuery = request.q;
  if (rawQuery.length === 1 || rawQuery.length > 200) {
    return { ok: true, response: { results: [], nextCursor: null } };
  }
  const cursor = decodeTicketSearchCursor(request.cursor);
  if (request.cursor && !cursor) return { ok: false, code: "INVALID_TICKET_SEARCH_CURSOR" };

  let query = rawQuery;
  try {
    const url = new URL(rawQuery);
    query = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? rawQuery);
  } catch {
    // Plain ticket, group or communication identifier.
  }
  const normalized = query.trim().toUpperCase();
  const ticketHash = await sha256Hex(normalized);
  const likeQuery = `%${query.trim()}%`;
  const numericText = normalized.replace(/^[GF]-?/, "");
  const numericQuery = /^\d+$/.test(numericText) ? String(Number(numericText)) : "";
  const conditions = ["tg.operation_day_id = ?1"];
  const bindings: Array<string | number> = [eventId];
  const bind = (value: string | number) => {
    bindings.push(value);
    return `?${bindings.length}`;
  };
  if (request.ticketGroupIds.length > 0) {
    const placeholders = request.ticketGroupIds.map((id) => bind(id));
    conditions.push(`tg.id IN (${placeholders.join(", ")})`);
  } else {
    conditions.push(ticketSearchStatusCondition(request.status));
  }
  if (request.soldByOperatorAccountId) {
    conditions.push(`tg.sold_by_operator_account_id = ${bind(request.soldByOperatorAccountId)}`);
  }
  if (normalized) {
    const ticketHashPlaceholder = bind(ticketHash);
    const likePlaceholder = bind(likeQuery);
    const numericPlaceholder = bind(numericQuery);
    const normalizedPlaceholder = bind(normalized);
    conditions.push(
      `(EXISTS (SELECT 1 FROM tickets searched_ticket
                  WHERE searched_ticket.ticket_group_id = tg.id
                    AND searched_ticket.public_code_hash = ${ticketHashPlaceholder})
        OR tg.public_status_code_hash = ${ticketHashPlaceholder}
        OR tg.id LIKE ${likePlaceholder}
        OR CAST(tg.communication_number AS TEXT) = ${numericPlaceholder}
        OR UPPER('G-' || p.code || '-' || printf('%04d', tg.communication_number))
             = ${normalizedPlaceholder}
        OR UPPER('G-' || printf('%04d', tg.communication_number)) = ${normalizedPlaceholder}
        OR UPPER(p.code || '-' || printf('%03d', tg.communication_number))
             = ${normalizedPlaceholder}
        OR EXISTS (SELECT 1 FROM tickets searched_ticket
                    JOIN rotation_tickets searched_rt ON searched_rt.ticket_id = searched_ticket.id
                    JOIN rotations searched_rotation ON searched_rotation.id = searched_rt.rotation_id
                    JOIN flight_groups searched_fg ON searched_fg.id = searched_rotation.flight_group_id
                    JOIN resource_groups searched_rg ON searched_rg.id = searched_fg.resource_group_id
                   WHERE searched_ticket.ticket_group_id = tg.id
                     AND (CAST(searched_fg.communication_number AS TEXT) = ${numericPlaceholder}
                       OR UPPER('F-' || searched_rg.short_code || '-' ||
                                printf('%03d', searched_fg.communication_number))
                            = ${normalizedPlaceholder}
                       OR UPPER(p.code || '-' || printf('%03d', searched_fg.communication_number)) = ${normalizedPlaceholder})))`,
    );
  }
  if (cursor) {
    const soldAtPlaceholder = bind(cursor.soldAt);
    const idPlaceholder = bind(cursor.id);
    conditions.push(
      `(tg.sold_at < ${soldAtPlaceholder} OR (tg.sold_at = ${soldAtPlaceholder} AND tg.id < ${idPlaceholder}))`,
    );
  }
  const effectiveLimit =
    request.ticketGroupIds.length > 0 ? Math.min(request.ticketGroupIds.length, 50) : request.limit;
  const limitPlaceholder = bind(effectiveLimit + 1);
  const rows = await database
    .prepare(
      `SELECT tg.id AS ticket_group_id, tg.status AS group_status,
              tg.queue_sequence, tg.communication_number AS booking_group_number, tg.standby,
              tg.sold_at, p.id AS product_id, p.code AS product_code, p.name AS product_name,
              tg.sold_by_operator_account_id, seller.login_code AS sold_by_operator_login_code,
              rg.short_code AS resource_group_short_code,
              (SELECT COUNT(*) FROM tickets group_ticket WHERE group_ticket.ticket_group_id = tg.id)
                AS group_size,
              (SELECT GROUP_CONCAT(DISTINCT group_fg.communication_number)
                 FROM tickets grouped_ticket
                 JOIN rotation_tickets group_rt
                   ON group_rt.ticket_id = grouped_ticket.id AND group_rt.released_at IS NULL
                 JOIN rotations group_rotation ON group_rotation.id = group_rt.rotation_id
                 JOIN flight_groups group_fg ON group_fg.id = group_rotation.flight_group_id
                WHERE grouped_ticket.ticket_group_id = tg.id) AS communication_numbers,
              (SELECT GROUP_CONCAT(DISTINCT group_rotation.status)
                 FROM tickets grouped_ticket
                 JOIN rotation_tickets group_rt
                   ON group_rt.ticket_id = grouped_ticket.id AND group_rt.released_at IS NULL
                 JOIN rotations group_rotation ON group_rotation.id = group_rt.rotation_id
                WHERE grouped_ticket.ticket_group_id = tg.id) AS rotation_statuses
         FROM ticket_groups tg
         JOIN products p ON p.id = tg.product_id
         JOIN resource_groups rg ON rg.id = p.resource_group_id
         LEFT JOIN operator_accounts seller ON seller.id = tg.sold_by_operator_account_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY tg.sold_at DESC, tg.id DESC LIMIT ${limitPlaceholder}`,
    )
    .bind(...bindings)
    .all<TicketSearchRow>();
  const page = rows.results.slice(0, effectiveLimit);
  const last = page.at(-1);
  return {
    ok: true,
    response: {
      results: page.map((row) => {
        const communicationNumbers = (row.communication_numbers?.split(",") ?? [])
          .map(Number)
          .filter(Number.isInteger)
          .sort((left, right) => left - right);
        const communicationLabels = communicationNumbers.map((number) =>
          formatFlightGroupLabel(row.resource_group_short_code, number),
        );
        const rotationStatuses = (row.rotation_statuses?.split(",") ?? []).sort();
        return {
          ticketGroupId: row.ticket_group_id,
          productId: row.product_id,
          productCode: row.product_code,
          productName: row.product_name,
          groupStatus: row.group_status as TicketSearchResponse["results"][number]["groupStatus"],
          groupSize: row.group_size,
          queueSequence: row.queue_sequence,
          bookingGroupNumber: row.booking_group_number,
          bookingGroupLabel: formatBookingGroupLabel(row.product_code, row.booking_group_number),
          standby: row.standby === 1,
          soldAt: row.sold_at,
          soldByOperatorAccountId: row.sold_by_operator_account_id,
          soldByOperatorLoginCode: row.sold_by_operator_login_code,
          communicationNumber: communicationNumbers[0] ?? null,
          communicationLabel: communicationLabels[0] ?? null,
          communicationNumbers,
          communicationLabels,
          rotationStatus: rotationStatuses[0] ?? null,
          rotationStatuses,
        };
      }),
      nextCursor:
        request.ticketGroupIds.length === 0 && rows.results.length > effectiveLimit && last
          ? encodeTicketSearchCursor({ soldAt: last.sold_at, id: last.ticket_group_id })
          : null,
    },
  };
}

export async function loadTicketGroupPrintData(
  database: D1Database,
  eventId: string,
  ticketGroupId: string,
): Promise<TicketGroupPrintResult> {
  const row = await database
    .prepare(
      `SELECT COALESCE(tg.public_status_code,
                       (SELECT legacy.public_code
                          FROM tickets legacy
                         WHERE legacy.ticket_group_id = tg.id AND legacy.public_code IS NOT NULL
                         ORDER BY legacy.created_at, legacy.id LIMIT 1)) AS public_code,
              od.name AS event_name, p.name AS product_name, g.label AS gate_label,
              p.code AS product_code, tg.communication_number, tg.status AS group_status,
              COUNT(t.id) AS group_size
         FROM ticket_groups tg
         JOIN operation_days od ON od.id = tg.operation_day_id
         JOIN products p ON p.id = tg.product_id
         JOIN gates g ON g.id = p.gate_id
         JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE tg.id = ?1 AND tg.operation_day_id = ?2
        GROUP BY tg.id`,
    )
    .bind(ticketGroupId, eventId)
    .first<TicketGroupPrintRow>();
  if (!row?.public_code) return { status: "NOT_FOUND" };
  if (row.group_status === "CANCELED") return { status: "CANCELED" };
  return {
    status: "READY",
    data: {
      ticketGroupId,
      eventName: row.event_name,
      productName: row.product_name,
      gateLabel: row.gate_label,
      communicationLabel: formatBookingGroupLabel(row.product_code, row.communication_number),
      code: row.public_code,
      groupSize: row.group_size,
    },
  };
}
