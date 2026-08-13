import {
  buildDeletionStatements,
  type EventDeletionReceiptRow,
  errorResult,
  finishCleanup,
  loadDeletionEvent,
  replayEventDeletion,
} from "./admin-event-deletion-support";
import { sessionBrowserBindingHash } from "./auth";
import { sha256Hex, verifyCredential } from "./crypto";
import { authorizeDevice } from "./device-authorization";
import { type EventDeletionResponse, finishEventDeletionAssetCleanup } from "./event-deletion";
import type { Env } from "./types";

export interface AdminEventDeletionInput {
  commandId: string;
  expectedVersion: number;
  confirmation: string;
  reason: string;
}

export interface AdminEventDeletionErrorResponse {
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

export type AdminEventDeletionDependencies = typeof defaultDependencies;

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
