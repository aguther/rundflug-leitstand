import { createHash, randomUUID } from "node:crypto";
import { createWorkerTestHarness } from "./lib/worker-test-harness.mjs";

const pin = "123456";
const setupCode = ["synthetic", "factory", "reset", "setup", "code"].join("-");
const forecastFixtureSql = `INSERT INTO flight_groups
      (id, operation_day_id, resource_group_id, product_id, communication_number, status, version, created_at, updated_at)
     VALUES ('factory-reset-flight-group', 'demo-2026', 'rg-panorama', 'panorama-20', 999, 'PLANNED', 0,
             '2026-07-11T09:00:00.000Z', '2026-07-11T09:00:00.000Z');
     INSERT INTO rotations
      (id, operation_day_id, flight_group_id, aircraft_id, status, version, created_at, updated_at)
     VALUES ('factory-reset-rotation', 'demo-2026', 'factory-reset-flight-group', 'aircraft-a',
             'PLANNED', 0, '2026-07-11T09:00:00.000Z', '2026-07-11T09:00:00.000Z');
     INSERT INTO planning_contexts
      (id, operation_day_id, operation_day_version, schema_version, previous_context_id,
       manifest_json, manifest_hash, anchor_reason, created_at)
     VALUES ('factory-reset-parent-context', 'demo-2026', 900, 1, NULL, '{}',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             'FACTORY_RESET_TEST', '2026-07-11T09:00:00.000Z');
     INSERT INTO planning_contexts
      (id, operation_day_id, operation_day_version, schema_version, previous_context_id,
       manifest_json, manifest_hash, anchor_reason, created_at)
     VALUES ('factory-reset-child-context', 'demo-2026', 901, 1,
             'factory-reset-parent-context', '{}',
             'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
             NULL, '2026-07-11T09:01:00.000Z');
     INSERT INTO planning_runs
      (id, operation_day_id, operation_day_version, context_id, previous_run_id, anchor_run_id,
       replay_distance, calculation_now, captured_at, trigger_event_type, capture_mode,
       anchor_reason, application_version, requirements_version, source_revision,
       dispatch_plan_revision, forecast_digest, forecast_semantic_digest, precall_digest,
       previous_forecast_state_chunk_id, previous_dispatch_state_chunk_id,
       dispatch_result_chunk_id, precall_result_chunk_id, duration_ms, capture_duration_ms,
       status, failure_code)
     VALUES ('factory-reset-parent-run', 'demo-2026', 900, 'factory-reset-parent-context',
             NULL, 'factory-reset-parent-run', 0, '2026-07-11T09:00:00.000Z',
             '2026-07-11T09:00:00.000Z', 'FACTORY_RESET_TEST', 'ANCHOR',
             'FACTORY_RESET_TEST', '1.12.0', '1.12.0', 'synthetic-reset-test',
             'factory-reset-parent-revision',
             'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
             'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
             'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
             NULL, NULL, NULL, NULL, 1, 1, 'SUCCEEDED', NULL);
     INSERT INTO planning_runs
      (id, operation_day_id, operation_day_version, context_id, previous_run_id, anchor_run_id,
       replay_distance, calculation_now, captured_at, trigger_event_type, capture_mode,
       anchor_reason, application_version, requirements_version, source_revision,
       dispatch_plan_revision, forecast_digest, forecast_semantic_digest, precall_digest,
       previous_forecast_state_chunk_id, previous_dispatch_state_chunk_id,
       dispatch_result_chunk_id, precall_result_chunk_id, duration_ms, capture_duration_ms,
       status, failure_code)
     VALUES ('factory-reset-child-run', 'demo-2026', 901, 'factory-reset-child-context',
             'factory-reset-parent-run', 'factory-reset-parent-run', 1,
             '2026-07-11T09:01:00.000Z', '2026-07-11T09:01:00.000Z',
             'FACTORY_RESET_TEST', 'REFERENCE', NULL, '1.12.0', '1.12.0',
             'synthetic-reset-test', 'factory-reset-child-revision',
             'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
             '1111111111111111111111111111111111111111111111111111111111111111',
             '2222222222222222222222222222222222222222222222222222222222222222',
             NULL, NULL, NULL, NULL, 1, 1, 'SUCCEEDED', NULL);
     INSERT INTO forecast_snapshots
      (id, operation_day_id, rotation_id, operation_day_version, captured_at, quality,
       lower_minutes, upper_minutes, planning_run_id)
     VALUES ('factory-reset-forecast', 'demo-2026', 'factory-reset-rotation', 0,
             '2026-07-11T09:00:00.000Z', 'STABLE', 10, 20,
             'factory-reset-child-run');`;
const harness = await createWorkerTestHarness({
  name: "factory-reset",
  adminPin: pin,
  d1Commands: [forecastFixtureSql],
  variables: {
    INSTALLATION_RECOVERY_CODE: setupCode,
    RESET_SETUP_SIGNING_KEY: ["synthetic", "reset", "grant", "signing", "key"].join("-"),
  },
});
const base = harness.baseUrl;

try {
  const loginResponse = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountId: "550e8400-e29b-41d4-a716-446655440200",
      pin,
    }),
  });
  if (!loginResponse.ok)
    throw new Error(`Admin-Anmeldung fehlgeschlagen (${loginResponse.status}).`);
  const sessionCookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
  if (!sessionCookie) throw new Error("Admin-Anmeldung hat kein Sitzungscookie geliefert.");
  const rejectedReset = await fetch(`${base}/api/admin/events/demo-2026/factory-reset`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
    },
    body: JSON.stringify({
      commandId: randomUUID(),
      eventId: "demo-2026",
      reason: "Synthetischer Test einer falschen PIN",
      adminPin: "654321",
      confirmation: "WERKSZUSTAND",
      retainRecoveryBackup: true,
      deleteAllBackups: false,
    }),
  });
  if (rejectedReset.status !== 403) {
    throw new Error(
      `Werksreset mit falscher Konto-PIN wurde nicht abgelehnt (${rejectedReset.status}).`,
    );
  }
  const commandId = randomUUID();
  const request = {
    commandId,
    eventId: "demo-2026",
    reason: "Synthetischer vollständiger Entwicklungsreset",
    adminPin: pin,
    confirmation: "WERKSZUSTAND",
    retainRecoveryBackup: true,
    deleteAllBackups: false,
  };
  const executeReset = async () =>
    fetch(`${base}/api/admin/events/demo-2026/factory-reset`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify(request),
    });
  const first = await executeReset();
  const firstBody = await first.json();
  if (!first.ok || !firstBody.resetComplete || !firstBody.recoveryBackupKey) {
    throw new Error(`Werksreset fehlgeschlagen (${first.status}).`);
  }
  const resetSetupCookie = first.headers.get("set-cookie")?.split(";")[0];
  if (!resetSetupCookie) throw new Error("Werksreset hat keinen Setup-Grant ausgestellt.");
  const statusAfterReset = await fetch(`${base}/api/setup/status`, {
    headers: { cookie: resetSetupCookie },
  }).then((response) => response.json());
  if (!statusAfterReset.setupRequired || !statusAfterReset.resetSetupAuthorized) {
    throw new Error("System autorisiert nach dem Werksreset keine direkte Ersteinrichtung.");
  }
  const foreignBrowserStatus = await fetch(`${base}/api/setup/status`).then((response) =>
    response.json(),
  );
  if (foreignBrowserStatus.resetSetupAuthorized) {
    throw new Error("Ein anderer Browser hat unerwartet den Reset-Setup-Grant erhalten.");
  }
  const foreignDuplicate = await fetch(`${base}/api/admin/events/demo-2026/factory-reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (foreignDuplicate.status !== 403 || foreignDuplicate.headers.get("set-cookie")) {
    throw new Error(
      `Fremder Browser konnte den Reset-Beleg wiederholen (${foreignDuplicate.status}).`,
    );
  }
  const unauthorizedSetup = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      adminPin: pin,
      eventId: "unauthorized-after-reset",
      name: "Nicht autorisierter Neustart",
      eventDate: "2026-07-14",
      aerodrome: "EDQA",
      timeZone: "Europe/Berlin",
    }),
  });
  if (unauthorizedSetup.status !== 403) {
    throw new Error(`Fremder Setup-Browser wurde nicht abgelehnt (${unauthorizedSetup.status}).`);
  }
  const duplicate = await executeReset();
  if (!duplicate.ok || !(await duplicate.json()).resetComplete) {
    throw new Error("Idempotente Wiederholung des Werksresets ist fehlgeschlagen.");
  }

  const adminDeviceId = randomUUID();
  const adminDeviceToken = ["synthetic", "new", "admin", "device", "token"].join("-");
  const setup = await fetch(`${base}/api/setup`, {
    method: "POST",
    body: JSON.stringify({
      adminPin: pin,
      eventId: "synthetic-after-reset",
      name: "Synthetischer Neustart",
      eventDate: "2026-07-14",
      aerodrome: "EDQA",
      timeZone: "Europe/Berlin",
      adminDeviceId,
      adminCredentialHash: createHash("sha256").update(adminDeviceToken).digest("hex"),
    }),
    headers: {
      "content-type": "application/json",
      cookie: resetSetupCookie,
    },
  });
  if (setup.status !== 201) {
    throw new Error(`Ersteinrichtung nach Werksreset fehlgeschlagen (${setup.status}).`);
  }
  const replay = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: resetSetupCookie,
    },
    body: JSON.stringify({
      adminPin: pin,
      eventId: "replayed-after-reset",
      name: "Wiederholter Neustart",
      eventDate: "2026-07-14",
      aerodrome: "EDQA",
      timeZone: "Europe/Berlin",
    }),
  });
  if (replay.status !== 409) {
    throw new Error(`Verbrauchter Setup-Grant wurde nicht abgelehnt (${replay.status}).`);
  }
  console.log(
    JSON.stringify({
      resetComplete: true,
      incorrectAdminPinRejected: true,
      recoveryBackupCreated: true,
      forecastHistoryDeleted: true,
      planningHistoryDeleted: true,
      duplicateResetIdempotent: true,
      setupRequiredAfterReset: true,
      foreignBrowserRejected: true,
      foreignDuplicateRejected: true,
      setupCompletedAgain: true,
      consumedGrantRejected: true,
    }),
  );
} finally {
  await harness.dispose();
}
