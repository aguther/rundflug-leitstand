import { sessionBrowserBindingHash } from "./auth";
import { sha256Hex, verifyCredential } from "./crypto";
import { authorizeDevice } from "./device-authorization";
import {
  type EventDeletionResponse,
  eventDeletionStatements,
  finishEventDeletionAssetCleanup,
} from "./event-deletion";
import type { Env } from "./types";

export interface AdminEventDeletionInput {
  commandId: string;
  expectedVersion: number;
  confirmation: string;
  reason: string;
}

interface AdminEventDeletionErrorResponse {
  error: {
    code:
      | "ADMIN_REQUIRED"
      | "IDEMPOTENCY_CONFLICT"
      | "EVENT_NOT_FOUND"
      | "EVENT_VERSION_CONFLICT"
      | "EVENT_DELETE_REPLACEMENT_MISSING"
      | "EVENT_DELETE_BOOTSTRAP_REPLACEMENT_MISSING"
      | "EVENT_BUSY";
    message: string;
    currentVersion?: number;
  };
}

export type AdminEventDeletionResult =
  | { status: 200 | 202; body: EventDeletionResponse }
  | { status: 403 | 404 | 409; body: AdminEventDeletionErrorResponse };

const defaultDependencies = {
  authorizeDevice,
  finishEventDeletionAssetCleanup,
  now: () => new Date(),
  sessionBrowserBindingHash,
  sha256Hex,
  verifyCredential,
};

type AdminEventDeletionDependencies = typeof defaultDependencies;

interface EventDeletionReceiptRow {
  request_hash: string;
  actor_device_id: string;
  browser_binding_hash: string | null;
  legacy_credential_hash: string | null;
  r2_cleanup_pending: number;
  logo_object_keys_json: string;
  response_json: string;
}

function errorResult(
  status: 403 | 404 | 409,
  code: AdminEventDeletionErrorResponse["error"]["code"],
  message: string,
  currentVersion?: number,
): AdminEventDeletionResult {
  return {
    status,
    body: {
      error: {
        code,
        message,
        ...(currentVersion === undefined ? {} : { currentVersion }),
      },
    },
  };
}

async function replayEventDeletion(
  env: Env,
  input: AdminEventDeletionInput,
  request: Request,
  requestHash: string,
  prior: EventDeletionReceiptRow,
  dependencies: AdminEventDeletionDependencies,
): Promise<AdminEventDeletionResult> {
  const browserBindingHash = await dependencies.sessionBrowserBindingHash(request);
  const browserMatches =
    Boolean(browserBindingHash) && browserBindingHash === prior.browser_binding_hash;
  const legacyMatches =
    env.APP_ENV === "development" &&
    request.headers.get("x-device-id") === prior.actor_device_id &&
    (await dependencies.verifyCredential(
      request.headers.get("x-device-token") ?? null,
      prior.legacy_credential_hash,
    ));
  if (!browserMatches && !legacyMatches) {
    return errorResult(403, "ADMIN_REQUIRED", "Administration erforderlich.");
  }
  if (prior.request_hash !== requestHash) {
    return errorResult(409, "IDEMPOTENCY_CONFLICT", "Kommando-ID ist bereits belegt.");
  }
  let response = JSON.parse(prior.response_json) as EventDeletionResponse;
  if (prior.r2_cleanup_pending) {
    const logoObjectKeys = JSON.parse(prior.logo_object_keys_json) as string[];
    try {
      response = await dependencies.finishEventDeletionAssetCleanup(
        env,
        input.commandId,
        logoObjectKeys,
        response,
      );
    } catch {
      return { status: 202, body: response };
    }
  }
  return { status: 200, body: response };
}

async function finishCleanup(
  env: Env,
  commandId: string,
  logoObjectKeys: string[],
  response: EventDeletionResponse,
  dependencies: AdminEventDeletionDependencies,
): Promise<AdminEventDeletionResult> {
  try {
    return {
      status: 200,
      body: await dependencies.finishEventDeletionAssetCleanup(
        env,
        commandId,
        logoObjectKeys,
        response,
      ),
    };
  } catch {
    return { status: 202, body: response };
  }
}

function buildDeletionStatements(input: {
  env: Env;
  command: AdminEventDeletionInput;
  requestHash: string;
  sourceEventId: string;
  eventId: string;
  eventVersion: number;
  actorDeviceId: string;
  browserBindingHash: string | null;
  legacyCredentialHash: string | null;
  completedAt: string;
  logoObjectKeys: string[];
  response: EventDeletionResponse;
  lastEvent: boolean;
  replacement: { id: string; admin_device_id: string } | null;
  sessionRebindEvent: { id: string } | null;
}): D1PreparedStatement[] {
  const statements = [
    input.env.DB.prepare("UPDATE system_reset_control SET active = 1 WHERE singleton = 1"),
  ];
  if (input.lastEvent) {
    statements.push(input.env.DB.prepare("DELETE FROM app_bootstrap"));
  } else if (input.replacement) {
    statements.push(
      input.env.DB.prepare(
        `UPDATE app_bootstrap
            SET operation_day_id = ?1, admin_device_id = ?2
          WHERE singleton = 1 AND operation_day_id = ?3`,
      ).bind(input.replacement.id, input.replacement.admin_device_id, input.eventId),
    );
  }
  if (input.sessionRebindEvent) {
    statements.push(
      input.env.DB.prepare(
        `UPDATE paired_devices
            SET operation_day_id = ?1, last_seen_at = ?2
          WHERE operation_day_id = ?3
            AND id IN (
              SELECT device_id
                FROM operator_sessions
               WHERE revoked_at IS NULL
                 AND absolute_expires_at > ?2
            )`,
      ).bind(input.sessionRebindEvent.id, input.completedAt, input.eventId),
    );
  }
  statements.push(...eventDeletionStatements(input.env, input.eventId));
  if (input.lastEvent) {
    statements.push(
      input.env.DB.prepare("DELETE FROM operator_sessions"),
      input.env.DB.prepare("DELETE FROM operator_accounts"),
    );
  }
  statements.push(
    input.env.DB.prepare("UPDATE system_reset_control SET active = 0 WHERE singleton = 1"),
    input.env.DB.prepare(
      `INSERT INTO event_deletion_receipts
          (command_id, request_hash, source_operation_day_id, target_operation_day_id,
           target_version, actor_device_id, browser_binding_hash, legacy_credential_hash,
           completed_at, r2_cleanup_pending, logo_object_keys_json, response_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    ).bind(
      input.command.commandId,
      input.requestHash,
      input.sourceEventId,
      input.eventId,
      input.eventVersion,
      input.actorDeviceId,
      input.browserBindingHash,
      input.legacyCredentialHash,
      input.completedAt,
      1,
      JSON.stringify(input.logoObjectKeys),
      JSON.stringify(input.response),
    ),
  );
  return statements;
}

async function loadDeletionEvent(
  env: Env,
  eventId: string,
  expectedVersion: number,
): Promise<
  | {
      id: string;
      version: number;
      logo_object_key: string | null;
      logo_dark_object_key: string | null;
    }
  | AdminEventDeletionResult
> {
  const event = await env.DB.prepare(
    `SELECT id, version, logo_object_key, logo_dark_object_key
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<{
      id: string;
      version: number;
      logo_object_key: string | null;
      logo_dark_object_key: string | null;
    }>();
  if (!event) return errorResult(404, "EVENT_NOT_FOUND", "Veranstaltung nicht gefunden.");
  if (event.version === expectedVersion) return event;
  return errorResult(
    409,
    "EVENT_VERSION_CONFLICT",
    "Die Veranstaltung wurde inzwischen geändert.",
    event.version,
  );
}

export async function deleteAdminEvent(
  env: Env,
  eventId: string,
  sourceEventId: string,
  input: AdminEventDeletionInput,
  request: Request,
  dependencies: AdminEventDeletionDependencies = defaultDependencies,
): Promise<AdminEventDeletionResult> {
  const requestHash = await dependencies.sha256Hex(
    JSON.stringify({
      sourceEventId,
      eventId,
      expectedVersion: input.expectedVersion,
      confirmation: input.confirmation,
      reason: input.reason,
    }),
  );
  const prior = await env.DB.prepare(
    `SELECT request_hash, actor_device_id, browser_binding_hash, legacy_credential_hash,
            r2_cleanup_pending, logo_object_keys_json, response_json
       FROM event_deletion_receipts WHERE command_id = ?1`,
  )
    .bind(input.commandId)
    .first<EventDeletionReceiptRow>();
  if (prior) {
    return replayEventDeletion(env, input, request, requestHash, prior, dependencies);
  }

  const device = await dependencies.authorizeDevice(env, sourceEventId, request);
  if (device?.role !== "ADMIN") {
    return errorResult(403, "ADMIN_REQUIRED", "Administration erforderlich.");
  }
  const eventResult = await loadDeletionEvent(env, eventId, input.expectedVersion);
  if ("status" in eventResult) return eventResult;
  const event = eventResult;

  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM operation_days").first<{
    count: number;
  }>();
  const lastEvent = (count?.count ?? 0) <= 1;
  const bootstrap = await env.DB.prepare(
    "SELECT operation_day_id FROM app_bootstrap WHERE singleton = 1",
  ).first<{ operation_day_id: string }>();
  const sessionRebindEvent = !lastEvent
    ? await env.DB.prepare(
        `SELECT id
             FROM operation_days
            WHERE id <> ?1
            ORDER BY CASE WHEN id = ?2 THEN 0 ELSE 1 END,
                     event_date DESC, created_at DESC, id
            LIMIT 1`,
      )
        .bind(eventId, sourceEventId)
        .first<{ id: string }>()
    : null;
  if (!lastEvent && !sessionRebindEvent) {
    return errorResult(
      409,
      "EVENT_DELETE_REPLACEMENT_MISSING",
      "Für aktive Sitzungen wurde keine verbleibende Veranstaltung gefunden.",
    );
  }
  const replacement =
    !lastEvent && bootstrap?.operation_day_id === eventId
      ? await env.DB.prepare(
          `SELECT operation_day.id, device.id AS admin_device_id
             FROM operation_days operation_day
             JOIN paired_devices device
               ON device.operation_day_id = operation_day.id
              AND device.role = 'ADMIN'
              AND device.active = 1
            WHERE operation_day.id <> ?1
            ORDER BY CASE WHEN operation_day.id = ?2 THEN 0 ELSE 1 END,
                     operation_day.event_date DESC,
                     operation_day.created_at DESC,
                     operation_day.id,
                     device.paired_at
            LIMIT 1`,
        )
          .bind(eventId, sourceEventId)
          .first<{ id: string; admin_device_id: string }>()
      : null;
  if (!lastEvent && bootstrap?.operation_day_id === eventId && !replacement) {
    return errorResult(
      409,
      "EVENT_DELETE_BOOTSTRAP_REPLACEMENT_MISSING",
      "Für die verbleibende Veranstaltung fehlt eine aktive Administrationssitzung.",
    );
  }

  const browserBindingHash = await dependencies.sessionBrowserBindingHash(request);
  const legacyCredentialHash =
    browserBindingHash === null && env.APP_ENV === "development"
      ? ((
          await env.DB.prepare(
            `SELECT credential_hash FROM paired_devices
              WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
          )
            .bind(device.id, sourceEventId)
            .first<{ credential_hash: string | null }>()
        )?.credential_hash ?? null)
      : null;
  if (!browserBindingHash && !legacyCredentialHash) {
    return errorResult(403, "ADMIN_REQUIRED", "Administration erforderlich.");
  }

  const coordinator = env.EVENT_COORDINATOR.get(env.EVENT_COORDINATOR.idFromName(eventId));
  const cleared = await coordinator.fetch(`https://internal/events/${eventId}/factory-reset`, {
    method: "POST",
  });
  if (!cleared.ok) {
    return errorResult(409, "EVENT_BUSY", "Veranstaltung konnte nicht geleert werden.");
  }

  const logoObjectKeys = [...new Set([event.logo_object_key, event.logo_dark_object_key])].filter(
    (key): key is string => Boolean(key),
  );
  const completedAt = dependencies.now().toISOString();
  const response: EventDeletionResponse = {
    deleted: true,
    eventId,
    setupRequired: lastEvent,
    assetCleanupPending: true,
  };
  const statements = buildDeletionStatements({
    env,
    command: input,
    requestHash,
    sourceEventId,
    eventId,
    eventVersion: event.version,
    actorDeviceId: device.id,
    browserBindingHash,
    legacyCredentialHash,
    completedAt,
    logoObjectKeys,
    response,
    lastEvent,
    replacement,
    sessionRebindEvent,
  });
  await env.DB.batch(statements);
  return finishCleanup(env, input.commandId, logoObjectKeys, response, dependencies);
}
