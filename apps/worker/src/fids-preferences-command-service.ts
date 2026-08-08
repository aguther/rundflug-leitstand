import {
  type FidsPreferences,
  type UpdateFidsPreferences,
  updateFidsPreferencesSchema,
} from "@rundflug/contracts";
import { mayAccessFids } from "./fids-authorization";
import { loadFidsPreferences, normalizeFidsContentFilter } from "./fids-preferences-storage";
import type { Env } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

function eventIdFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const eventsIndex = segments.indexOf("events");
  return eventsIndex >= 0 ? (segments[eventsIndex + 1] ?? null) : null;
}

export class FidsPreferencesCommandService {
  constructor(private readonly env: Env) {}

  async handleUpdate(request: Request, url: URL): Promise<Response> {
    const eventId = eventIdFromPath(url.pathname);
    const accountId = request.headers.get("x-operator-account-id");
    const loginCode = request.headers.get("x-operator-login-code");
    const sessionId = request.headers.get("x-operator-session-id");
    const deviceId = request.headers.get("x-operator-device-id");
    const role = request.headers.get("x-operator-role");
    if (!eventId || !accountId || !loginCode || !sessionId || !deviceId || !mayAccessFids(role)) {
      return json(
        {
          error: {
            code: "SESSION_NOT_AUTHORIZED",
            message: "Sitzung für diese Ansicht nicht berechtigt.",
          },
        },
        { status: 403 },
      );
    }

    let input: UpdateFidsPreferences;
    try {
      input = updateFidsPreferencesSchema.parse(await request.json());
    } catch {
      return json(
        { error: { code: "INVALID_FIDS_PREFERENCES", message: "Einstellungen sind ungültig." } },
        { status: 400 },
      );
    }

    const prior = await this.env.DB.prepare(
      `SELECT operation_day_id, device_id, command_type, response_json
         FROM idempotency_receipts
        WHERE command_id = ?1`,
    )
      .bind(input.commandId)
      .first<{
        operation_day_id: string;
        device_id: string;
        command_type: string;
        response_json: string;
      }>();
    if (prior) {
      if (
        prior.operation_day_id !== eventId ||
        prior.device_id !== deviceId ||
        prior.command_type !== "UPDATE_FIDS_PREFERENCES"
      ) {
        return json(
          {
            error: {
              code: "IDEMPOTENCY_CONFLICT",
              message: "Die Kommando-ID wurde bereits für einen anderen Vorgang verwendet.",
            },
          },
          { status: 409 },
        );
      }
      return json(JSON.parse(prior.response_json) as FidsPreferences);
    }

    const event = await this.env.DB.prepare("SELECT id FROM operation_days WHERE id = ?1")
      .bind(eventId)
      .first<{ id: string }>();
    if (!event) {
      return json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        { status: 404 },
      );
    }

    const normalizedFilter = normalizeFidsContentFilter(input.contentFilter);
    const [knownProducts, knownGates] = await Promise.all([
      normalizedFilter.productIds.length === 0
        ? Promise.resolve({ results: [] as Array<{ id: string }> })
        : this.env.DB.prepare(
            `SELECT id FROM products
              WHERE operation_day_id = ?1
                AND id IN (SELECT value FROM json_each(?2))`,
          )
            .bind(eventId, JSON.stringify(normalizedFilter.productIds))
            .all<{ id: string }>(),
      normalizedFilter.gateIds.length === 0
        ? Promise.resolve({ results: [] as Array<{ id: string }> })
        : this.env.DB.prepare(
            `SELECT id FROM gates
              WHERE operation_day_id = ?1
                AND id IN (SELECT value FROM json_each(?2))`,
          )
            .bind(eventId, JSON.stringify(normalizedFilter.gateIds))
            .all<{ id: string }>(),
    ]);
    if (
      knownProducts.results.length !== normalizedFilter.productIds.length ||
      knownGates.results.length !== normalizedFilter.gateIds.length
    ) {
      return json(
        {
          error: {
            code: "FIDS_FILTER_OPTION_NOT_FOUND",
            message: "Mindestens eine Filteroption gehört nicht zu dieser Veranstaltung.",
          },
        },
        { status: 400 },
      );
    }

    const current = await loadFidsPreferences(this.env.DB, accountId, eventId);
    const currentVersion = current.version;
    if (currentVersion !== input.expectedVersion) {
      return json(
        {
          error: {
            code: "STALE_VERSION",
            message: "Die Einstellungen wurden zwischenzeitlich geändert.",
            currentVersion,
          },
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const next: FidsPreferences = {
      visibleRows: input.visibleRows,
      layout: input.layout,
      theme: input.theme,
      viewMode: input.viewMode,
      priorityGroupCount: input.priorityGroupCount,
      rotationIntervalSeconds: input.rotationIntervalSeconds,
      groupSharedFlights: input.groupSharedFlights,
      contentFilter: normalizedFilter,
      version: currentVersion + 1,
    };
    const auditPayload = {
      operatorAccountId: accountId,
      visibleRows: next.visibleRows,
      layout: next.layout,
      theme: next.theme,
      viewMode: next.viewMode,
      priorityGroupCount: next.priorityGroupCount,
      rotationIntervalSeconds: next.rotationIntervalSeconds,
      groupSharedFlights: next.groupSharedFlights,
      productIds: next.contentFilter.productIds,
      gateIds: next.contentFilter.gateIds,
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO fids_preferences
          (operator_account_id, operation_day_id, visible_rows, layout, theme, view_mode,
           priority_group_count, rotation_interval_seconds, group_shared_flights,
           content_filter_json, version,
           created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
         ON CONFLICT(operator_account_id, operation_day_id) DO UPDATE SET
           visible_rows = excluded.visible_rows,
           layout = excluded.layout,
           theme = excluded.theme,
           view_mode = excluded.view_mode,
           priority_group_count = excluded.priority_group_count,
           rotation_interval_seconds = excluded.rotation_interval_seconds,
           group_shared_flights = excluded.group_shared_flights,
           content_filter_json = excluded.content_filter_json,
           version = excluded.version,
           updated_at = excluded.updated_at
         WHERE fids_preferences.version = ?13`,
      ).bind(
        accountId,
        eventId,
        next.visibleRows,
        next.layout,
        next.theme,
        next.viewMode,
        next.priorityGroupCount,
        next.rotationIntervalSeconds,
        next.groupSharedFlights ? 1 : 0,
        JSON.stringify(next.contentFilter),
        next.version,
        now,
        currentVersion,
      ),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'FIDS_PREFERENCES_CHANGED', ?3, ?4, 'FIDS_PREFERENCES', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        eventId,
        now,
        deviceId,
        accountId,
        next.version,
        JSON.stringify(auditPayload),
      ),
      this.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         VALUES (?1, ?2, ?3, 'UPDATE_FIDS_PREFERENCES', ?4, ?5)`,
      ).bind(input.commandId, eventId, deviceId, now, JSON.stringify(next)),
      this.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         VALUES (?1, ?2, 'FIDS_PREFERENCES_CHANGED', ?3, ?4)`,
      ).bind(crypto.randomUUID(), eventId, JSON.stringify({ version: next.version }), now),
    ]);
    return json(next);
  }
}
