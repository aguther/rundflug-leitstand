import type {
  AdminEventDeletionDependencies,
  AdminEventDeletionErrorResponse,
  AdminEventDeletionInput,
  AdminEventDeletionResult,
} from "./admin-event-deletion-service";
import { type EventDeletionResponse, eventDeletionStatements } from "./event-deletion";
import type { Env } from "./types";

export interface EventDeletionReceiptRow {
  request_hash: string;
  actor_device_id: string;
  browser_binding_hash: string | null;
  legacy_credential_hash: string | null;
  r2_cleanup_pending: number;
  logo_object_keys_json: string;
  response_json: string;
}

export function errorResult(
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

export async function replayEventDeletion(
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

export async function finishCleanup(
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

export function buildDeletionStatements(input: {
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

export async function loadDeletionEvent(
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
