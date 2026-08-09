import type { EventLogoTheme } from "@rundflug/contracts";
import { type EventLogoMediaType, eventLogoExtension } from "./event-logo";
import type { Env } from "./types";

interface EventLogoRow {
  version: number;
  logo_object_key: string | null;
  logo_media_type: string | null;
  logo_dark_object_key: string | null;
  logo_dark_media_type: string | null;
}

interface EventLogoReceipt {
  operation_day_id: string;
  device_id: string;
  command_type: string;
  response_json: string;
}

interface EventLogoMutationInput {
  eventId: string;
  deviceId: string;
  commandId: string;
  expectedVersion: number;
  theme: EventLogoTheme;
}

export interface SetAdminEventLogoInput extends EventLogoMutationInput {
  loadUpload: () => Promise<{ bytes: Uint8Array; mediaType: EventLogoMediaType }>;
}

export type RemoveAdminEventLogoInput = EventLogoMutationInput;

export interface EventLogoSetResponse {
  logoUrl: string;
  theme: EventLogoTheme;
}

export interface EventLogoRemoveResponse {
  removed: boolean;
  theme: EventLogoTheme;
}

interface EventLogoErrorResponse {
  error: {
    code: "EVENT_LOGO_INVALID" | "IDEMPOTENCY_CONFLICT" | "EVENT_NOT_FOUND" | "STALE_VERSION";
    message: string;
  };
}

export type EventLogoMutationResult<TBody> =
  | { status: 200; body: TBody }
  | { status: 400 | 404 | 409; body: EventLogoErrorResponse };

const defaultDependencies = {
  now: () => new Date(),
  randomUuid: (): string => crypto.randomUUID(),
};

type AdminEventLogoDependencies = typeof defaultDependencies;

function eventLogoColumns(theme: EventLogoTheme): {
  key: "logo_object_key" | "logo_dark_object_key";
  mediaType: "logo_media_type" | "logo_dark_media_type";
} {
  return theme === "dark"
    ? { key: "logo_dark_object_key", mediaType: "logo_dark_media_type" }
    : { key: "logo_object_key", mediaType: "logo_media_type" };
}

function eventLogoCommandType(operation: "SET" | "REMOVE", theme: EventLogoTheme): string {
  return `${operation}_EVENT_LOGO_${theme.toUpperCase()}`;
}

function eventLogoReceiptMatches(
  receipt: EventLogoReceipt,
  input: {
    eventId: string;
    deviceId: string;
    commandType: string;
    theme: EventLogoTheme;
    operation: "SET" | "REMOVE";
  },
): boolean {
  if (receipt.operation_day_id !== input.eventId || receipt.device_id !== input.deviceId) {
    return false;
  }
  if (receipt.command_type === input.commandType) return true;
  const legacyCommandType = input.operation === "SET" ? "SET_EVENT_LOGO" : "REMOVE_EVENT_LOGO";
  return input.theme === "light" && receipt.command_type === legacyCommandType;
}

async function findEventLogoReceipt(env: Env, commandId: string): Promise<EventLogoReceipt | null> {
  return env.DB.prepare(
    `SELECT operation_day_id, device_id, command_type, response_json
       FROM idempotency_receipts
      WHERE command_id = ?1`,
  )
    .bind(commandId)
    .first<EventLogoReceipt>();
}

function errorResult(
  status: 400 | 404 | 409,
  code: EventLogoErrorResponse["error"]["code"],
  message: string,
): EventLogoMutationResult<never> {
  return { status, body: { error: { code, message } } };
}

async function replayEventLogoReceipt<TBody>(
  env: Env,
  commandId: string,
  receiptInput: Parameters<typeof eventLogoReceiptMatches>[1],
): Promise<EventLogoMutationResult<TBody> | null> {
  const receipt = await findEventLogoReceipt(env, commandId);
  if (!receipt) return null;
  if (!eventLogoReceiptMatches(receipt, receiptInput)) {
    return errorResult(409, "IDEMPOTENCY_CONFLICT", "Kommando-ID ist bereits belegt.");
  }
  return { status: 200, body: JSON.parse(receipt.response_json) as TBody };
}

async function loadEventLogo(env: Env, eventId: string): Promise<EventLogoRow | null> {
  return env.DB.prepare(
    `SELECT version, logo_object_key, logo_media_type,
            logo_dark_object_key, logo_dark_media_type
       FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<EventLogoRow>();
}

export async function setAdminEventLogo(
  env: Env,
  input: SetAdminEventLogoInput,
  dependencies: AdminEventLogoDependencies = defaultDependencies,
): Promise<EventLogoMutationResult<EventLogoSetResponse>> {
  const commandType = eventLogoCommandType("SET", input.theme);
  const receiptInput = {
    eventId: input.eventId,
    deviceId: input.deviceId,
    commandType,
    theme: input.theme,
    operation: "SET" as const,
  };
  const replay = await replayEventLogoReceipt<EventLogoSetResponse>(
    env,
    input.commandId,
    receiptInput,
  );
  if (replay) return replay;

  const columns = eventLogoColumns(input.theme);
  const event = await loadEventLogo(env, input.eventId);
  if (!event) {
    return errorResult(404, "EVENT_NOT_FOUND", "Veranstaltung nicht gefunden.");
  }
  if (event.version !== input.expectedVersion) {
    return errorResult(409, "STALE_VERSION", "Veranstaltung wurde zwischenzeitlich geändert.");
  }

  let upload: Awaited<ReturnType<SetAdminEventLogoInput["loadUpload"]>>;
  try {
    upload = await input.loadUpload();
  } catch {
    return errorResult(
      400,
      "EVENT_LOGO_INVALID",
      "Logo muss ein sicheres PNG, JPEG, WebP oder SVG bis 1 MiB sein.",
    );
  }

  const now = dependencies.now().toISOString();
  const objectKey = `event-logos/${input.eventId}/${dependencies.randomUuid()}.${eventLogoExtension(upload.mediaType)}`;
  await env.BACKUPS.put(objectKey, upload.bytes, {
    httpMetadata: { contentType: upload.mediaType },
    customMetadata: { eventId: input.eventId, theme: input.theme },
  });
  const response: EventLogoSetResponse = {
    logoUrl: `/api/public/events/${encodeURIComponent(input.eventId)}/logo?theme=${input.theme}`,
    theme: input.theme,
  };
  const responseJson = JSON.stringify(response);
  const mutationGuard = `id = ?1 AND version = ?2 AND ${columns.key} = ?3`;
  let results: D1Result[];
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE operation_days
            SET ${columns.key} = ?1, ${columns.mediaType} = ?2, logo_updated_at = ?3,
                version = version + 1, updated_at = ?3
          WHERE id = ?4 AND version = ?5`,
      ).bind(objectKey, upload.mediaType, now, input.eventId, input.expectedVersion),
      env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         SELECT ?4, ?1, 'EVENT_LOGO_CHANGED', ?5, ?6, 'OPERATION_DAY', ?1, ?2, ?7
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(
        input.eventId,
        input.expectedVersion + 1,
        objectKey,
        dependencies.randomUuid(),
        now,
        input.deviceId,
        JSON.stringify({ theme: input.theme, mediaType: upload.mediaType }),
      ),
      env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         SELECT ?4, ?1, ?5, ?6, ?7, ?8
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(
        input.eventId,
        input.expectedVersion + 1,
        objectKey,
        input.commandId,
        input.deviceId,
        commandType,
        now,
        responseJson,
      ),
      env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         SELECT ?4, ?1, 'EVENT_STATE_CHANGED', ?5, ?6
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(
        input.eventId,
        input.expectedVersion + 1,
        objectKey,
        dependencies.randomUuid(),
        responseJson,
        now,
      ),
    ]);
  } catch (cause) {
    await env.BACKUPS.delete(objectKey);
    const concurrentReplay = await replayEventLogoReceipt<EventLogoSetResponse>(
      env,
      input.commandId,
      receiptInput,
    );
    if (concurrentReplay) return concurrentReplay;
    throw cause;
  }
  if (results[0]?.meta.changes !== 1) {
    await env.BACKUPS.delete(objectKey);
    return errorResult(409, "STALE_VERSION", "Veranstaltung wurde zwischenzeitlich geändert.");
  }
  const previousObjectKey = event[columns.key];
  if (previousObjectKey && previousObjectKey !== objectKey) {
    await env.BACKUPS.delete(previousObjectKey);
  }
  return { status: 200, body: response };
}

export async function removeAdminEventLogo(
  env: Env,
  input: RemoveAdminEventLogoInput,
  dependencies: AdminEventLogoDependencies = defaultDependencies,
): Promise<EventLogoMutationResult<EventLogoRemoveResponse>> {
  const commandType = eventLogoCommandType("REMOVE", input.theme);
  const receiptInput = {
    eventId: input.eventId,
    deviceId: input.deviceId,
    commandType,
    theme: input.theme,
    operation: "REMOVE" as const,
  };
  const replay = await replayEventLogoReceipt<EventLogoRemoveResponse>(
    env,
    input.commandId,
    receiptInput,
  );
  if (replay) return replay;

  const columns = eventLogoColumns(input.theme);
  const event = await loadEventLogo(env, input.eventId);
  if (!event) {
    return errorResult(404, "EVENT_NOT_FOUND", "Veranstaltung nicht gefunden.");
  }
  if (event.version !== input.expectedVersion) {
    return errorResult(409, "STALE_VERSION", "Veranstaltung wurde zwischenzeitlich geändert.");
  }

  const now = dependencies.now().toISOString();
  const previousObjectKey = event[columns.key];
  const response: EventLogoRemoveResponse = {
    removed: Boolean(previousObjectKey),
    theme: input.theme,
  };
  const responseJson = JSON.stringify(response);
  if (!previousObjectKey) {
    try {
      const result = await env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
           FROM operation_days
          WHERE id = ?2 AND version = ?7 AND ${columns.key} IS NULL`,
      )
        .bind(
          input.commandId,
          input.eventId,
          input.deviceId,
          commandType,
          now,
          responseJson,
          input.expectedVersion,
        )
        .run();
      if (result.meta.changes !== 1) {
        return errorResult(409, "STALE_VERSION", "Veranstaltung wurde zwischenzeitlich geändert.");
      }
    } catch (cause) {
      const concurrentReplay = await replayEventLogoReceipt<EventLogoRemoveResponse>(
        env,
        input.commandId,
        receiptInput,
      );
      if (concurrentReplay) return concurrentReplay;
      throw cause;
    }
    return { status: 200, body: response };
  }

  const mutationGuard = `id = ?1 AND version = ?2 AND ${columns.key} IS NULL AND logo_updated_at = ?3`;
  let results: D1Result[];
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE operation_days
            SET ${columns.key} = NULL, ${columns.mediaType} = NULL,
                logo_updated_at = ?1, version = version + 1, updated_at = ?1
          WHERE id = ?2 AND version = ?3 AND ${columns.key} = ?4`,
      ).bind(now, input.eventId, input.expectedVersion, previousObjectKey),
      env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         SELECT ?4, ?1, 'EVENT_LOGO_REMOVED', ?3, ?5, 'OPERATION_DAY', ?1, ?2, ?6
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(
        input.eventId,
        input.expectedVersion + 1,
        now,
        dependencies.randomUuid(),
        input.deviceId,
        JSON.stringify({ theme: input.theme }),
      ),
      env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         SELECT ?4, ?1, ?5, ?6, ?3, ?7
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(
        input.eventId,
        input.expectedVersion + 1,
        now,
        input.commandId,
        input.deviceId,
        commandType,
        responseJson,
      ),
      env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         SELECT ?4, ?1, 'EVENT_STATE_CHANGED', ?5, ?3
           FROM operation_days
          WHERE ${mutationGuard}`,
      ).bind(
        input.eventId,
        input.expectedVersion + 1,
        now,
        dependencies.randomUuid(),
        responseJson,
      ),
    ]);
  } catch (cause) {
    const concurrentReplay = await replayEventLogoReceipt<EventLogoRemoveResponse>(
      env,
      input.commandId,
      receiptInput,
    );
    if (concurrentReplay) return concurrentReplay;
    throw cause;
  }
  if (results[0]?.meta.changes !== 1) {
    return errorResult(409, "STALE_VERSION", "Veranstaltung wurde zwischenzeitlich geändert.");
  }
  await env.BACKUPS.delete(previousObjectKey);
  return { status: 200, body: response };
}
