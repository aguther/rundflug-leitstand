/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { EventAdministrationCommandService } from "../src/event-administration-command-service";
import type { StoredEventRow } from "../src/types";

const eventId = "event-administration-runtime";

async function executeStatements(sql: string): Promise<void> {
  for (const statement of sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await env.DB.prepare(statement).run();
  }
}

const current: StoredEventRow = {
  id: eventId,
  name: "Synthetic event administration",
  event_date: "2026-08-08",
  time_zone: "Europe/Berlin",
  status: "ACTIVE",
  emergency_mode: 0,
  operational_interrupted: 0,
  version: 0,
  operational_note: "",
  operations_end_at: "2099-08-08T20:00:00.000Z",
  updated_at: "2026-08-08T08:00:00.000Z",
};

beforeEach(async () => {
  await executeStatements(`
    DROP TABLE IF EXISTS outbox;
    DROP TABLE IF EXISTS idempotency_receipts;
    DROP TABLE IF EXISTS operational_events;
    DROP TABLE IF EXISTS analysis_archive_events;
    DROP TABLE IF EXISTS analysis_archives;
    DROP TABLE IF EXISTS rotations;
    DROP TABLE IF EXISTS operation_days;

    CREATE TABLE operation_days (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      archived_at TEXT,
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE rotations (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE analysis_archives (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      operation_day_version INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      privacy_profile TEXT NOT NULL,
      format_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      source_revision TEXT NOT NULL,
      application_version TEXT NOT NULL,
      requirements_version TEXT NOT NULL,
      entry_counts_json TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      UNIQUE (operation_day_id, operation_day_version, privacy_profile, format_version)
    );
    CREATE TABLE analysis_archive_events (
      id TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL,
      operation_day_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      actor_alias TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
    CREATE TABLE operational_events (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      device_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE idempotency_receipts (
      command_id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      received_at TEXT NOT NULL,
      response_json TEXT NOT NULL
    );
    CREATE TABLE outbox (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO operation_days (id, status, archived_at, version, updated_at)
      VALUES ('${eventId}', 'ACTIVE', NULL, 0, '${current.updated_at}');
  `);
});

describe("event administration command service", () => {
  it("closes the event atomically, requests one archive, and defers archive building", async () => {
    const broadcasts: unknown[] = [];
    const deferred: Promise<unknown>[] = [];
    const blockedForecast = new Promise<void>(() => undefined);
    const service = new EventAdministrationCommandService(
      env,
      (result) => broadcasts.push(result),
      (promise) => deferred.push(promise),
      () => blockedForecast,
    );

    const response = await service.handleLifecycle(
      {
        commandId: "550e8400-e29b-41d4-a716-446655440030",
        eventId,
        deviceId: "event-admin-runtime-device",
        expectedVersion: 0,
        issuedAt: "2026-08-08T09:00:00.000Z",
        type: "SET_EVENT_LIFECYCLE",
        payload: { status: "CLOSED", reason: "Synthetic runtime close" },
      },
      current,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accepted: true,
      duplicate: false,
      event: { status: "CLOSED", version: 1 },
      eventType: "EVENT_CLOSED",
    });
    expect(
      await env.DB.prepare("SELECT status, archived_at, version FROM operation_days WHERE id = ?1")
        .bind(eventId)
        .first(),
    ).toEqual({ status: "CLOSED", archived_at: null, version: 1 });
    expect(
      await env.DB.prepare(
        "SELECT operation_day_version, status FROM analysis_archives WHERE operation_day_id = ?1",
      )
        .bind(eventId)
        .first(),
    ).toEqual({ operation_day_version: 1, status: "PENDING" });
    expect(
      await env.DB.prepare(
        "SELECT event_type, actor_alias FROM analysis_archive_events WHERE operation_day_id = ?1",
      )
        .bind(eventId)
        .first(),
    ).toEqual({ event_type: "ARCHIVE_REQUESTED", actor_alias: "system" });
    expect(
      await env.DB.prepare(
        "SELECT event_type, aggregate_version FROM operational_events WHERE operation_day_id = ?1",
      )
        .bind(eventId)
        .first(),
    ).toEqual({ event_type: "EVENT_CLOSED", aggregate_version: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox").first()).toEqual({
      count: 1,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM idempotency_receipts").first(),
    ).toEqual({ count: 1 });
    expect(broadcasts).toHaveLength(1);
    expect(deferred).toHaveLength(1);
  });
});
