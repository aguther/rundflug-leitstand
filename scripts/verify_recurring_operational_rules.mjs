import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.RECURRING_RULE_TEST_PORT ?? "18796");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
const reset = spawnSync(process.execPath, [npmCli, "run", "db:reset:local"], {
  cwd: root,
  stdio: "ignore",
});
if (reset.status !== 0) throw new Error("Lokale Testdatenbank konnte nicht initialisiert werden.");

const pin = "0000";
const server = spawn(
  process.execPath,
  [
    resolve(root, "node_modules", "wrangler", "bin", "wrangler.js"),
    "dev",
    "--config",
    "wrangler.jsonc",
    "--var",
    "APP_ENV:development",
    "--var",
    "DATA_JURISDICTION:eu",
    "--var",
    `ADMIN_PIN_HASH:${createHash("sha256").update(pin).digest("hex")}`,
    "--port",
    String(port),
  ],
  {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  },
);
const base = `http://127.0.0.1:${port}`;
const actors = {
  admin: {
    deviceId: "technical-scaffold",
    token: "demo-admin-device-token",
  },
  cashier: {
    deviceId: "cashier-tablet-1",
    token: "demo-cashier-device-token",
  },
  director: {
    deviceId: "recovery-flight-lead",
    token: "lead-device-credential",
  },
};

const waitForWorker = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Lokaler Worker wurde nicht rechtzeitig bereit.");
};
const board = async (actor) => {
  const response = await fetch(`${base}/api/control/demo-2026/operations`, {
    headers: {
      "x-device-id": actor.deviceId,
      "x-device-token": actor.token,
    },
  });
  if (!response.ok) throw new Error(`Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const commandEnvelope = (actor, expectedVersion, type, payload, commandId = randomUUID()) => ({
  commandId,
  eventId: "demo-2026",
  deviceId: actor.deviceId,
  expectedVersion,
  issuedAt: new Date().toISOString(),
  type,
  payload,
});
const send = async (actor, envelope, expectedStatus = 200) => {
  const response = await fetch(`${base}/api/control/demo-2026/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-token": actor.token,
    },
    body: JSON.stringify(envelope),
  });
  if (response.status !== expectedStatus) {
    throw new Error(
      `${envelope.type} lieferte ${response.status} statt ${expectedStatus}: ${await response.text()}`,
    );
  }
  return response.json();
};
const history = async (ruleId = null) => {
  const query = new URLSearchParams({ limit: "100" });
  if (ruleId) {
    query.set("aggregateType", "OPERATIONAL_RULE");
    query.set("aggregateId", ruleId);
  }
  const response = await fetch(`${base}/api/control/demo-2026/history?${query}`, {
    headers: {
      "x-device-id": actors.director.deviceId,
      "x-device-token": actors.director.token,
    },
  });
  if (!response.ok)
    throw new Error(`Regelhistorie konnte nicht geladen werden (${response.status}).`);
  return response.json();
};
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const flyOneRotation = async (version) => {
  const sold = await send(
    actors.cashier,
    commandEnvelope(actors.cashier, version, "SELL_TICKET_GROUP", {
      productId: "panorama-20",
      publicTicketCodes: [ticketCode()],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    }),
  );
  const called = await send(
    actors.director,
    commandEnvelope(actors.director, sold.event.version, "CALL_NEXT", {
      ticketGroupIds: [sold.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    }),
  );
  const departed = await send(
    actors.director,
    commandEnvelope(actors.director, called.event.version, "MARK_OFF_BLOCK", {
      rotationId: sold.aggregate.relatedRotationId,
    }),
  );
  const landed = await send(
    actors.director,
    commandEnvelope(actors.director, departed.event.version, "MARK_ON_BLOCK", {
      rotationId: sold.aggregate.relatedRotationId,
    }),
  );
  return send(
    actors.director,
    commandEnvelope(actors.director, landed.event.version, "COMPLETE_TURNAROUND", {
      rotationId: sold.aggregate.relatedRotationId,
      nextAircraftState: "AVAILABLE",
    }),
  );
};

const aircraftRuleId = randomUUID();
const pilotRuleId = randomUUID();
const aircraftRule = {
  scopeType: "AIRCRAFT",
  scopeId: "aircraft-a",
  kind: "REFUELING",
  triggerMetric: "COMPLETED_ROTATIONS",
  intervalValue: 1,
  minimumDurationMinutes: 8,
  typicalDurationMinutes: 12,
  maximumDurationMinutes: 18,
};

try {
  await waitForWorker();
  let current = await board(actors.admin);
  const configured = await send(
    actors.admin,
    commandEnvelope(actors.admin, current.event.version, "CONFIGURE_EVENT_PARAMETERS", {
      saleOpensAt: null,
      operationsEndAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      noShowAfterMinutes: 10,
      notificationLeadMinutes: 20,
      childReferenceWeightKg: 35,
      normalReferenceWeightKg: 80,
      heavyReferenceWeightKg: 110,
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 5,
      plannedBufferMinutes: 5,
      reason: "Synthetischer Regeltest",
      adminPin: pin,
    }),
  );
  const activated = await send(
    actors.admin,
    commandEnvelope(actors.admin, configured.event.version, "SET_EVENT_LIFECYCLE", {
      status: "ACTIVE",
      reason: "Synthetischer Regeltest",
      adminPin: pin,
    }),
  );

  await send(
    actors.cashier,
    commandEnvelope(actors.cashier, activated.event.version, "UPSERT_RECURRING_OPERATIONAL_RULE", {
      ruleId: aircraftRuleId,
      ruleExpectedVersion: null,
      rule: aircraftRule,
      reason: "Unzulässiger Kassentest",
    }),
    403,
  );
  const createCommandId = randomUUID();
  const createEnvelope = commandEnvelope(
    actors.director,
    activated.event.version,
    "UPSERT_RECURRING_OPERATIONAL_RULE",
    {
      ruleId: aircraftRuleId,
      ruleExpectedVersion: null,
      rule: aircraftRule,
      reason: "Tanken nach jedem bestätigten Umlauf",
    },
    createCommandId,
  );
  const created = await send(actors.director, createEnvelope);
  const duplicateCreate = await send(actors.director, createEnvelope);
  if (!duplicateCreate.duplicate || duplicateCreate.event.version !== created.event.version) {
    throw new Error("Idempotente Regelanlage wurde nicht als Duplikat bestätigt.");
  }
  await send(
    actors.director,
    commandEnvelope(actors.director, created.event.version, "UPSERT_RECURRING_OPERATIONAL_RULE", {
      ruleId: randomUUID(),
      ruleExpectedVersion: null,
      rule: aircraftRule,
      reason: "Unzulässige Doppelregel",
    }),
    409,
  );

  const firstCompletion = await flyOneRotation(created.event.version);
  current = await board(actors.director);
  const dueRule = current.recurringOperationalRules.find((rule) => rule.id === aircraftRuleId);
  const firstOccurrence = current.plannedOperations.find(
    (plan) => plan.recurringRuleId === aircraftRuleId && plan.recurrenceSequence === 1,
  );
  if (
    dueRule?.progressValue !== 1 ||
    dueRule.version !== 1 ||
    dueRule.openPlannedOperationId !== firstOccurrence?.id ||
    firstOccurrence?.status !== "DUE"
  ) {
    throw new Error("Erste Regelfälligkeit wurde nicht eindeutig und atomar projiziert.");
  }
  await send(
    actors.director,
    commandEnvelope(
      actors.director,
      firstCompletion.event.version,
      "UPSERT_RECURRING_OPERATIONAL_RULE",
      {
        ruleId: aircraftRuleId,
        ruleExpectedVersion: 0,
        rule: aircraftRule,
        reason: "Veralteter Regelstand",
      },
    ),
    409,
  );

  const skipCommandId = randomUUID();
  const skipEnvelope = commandEnvelope(
    actors.director,
    firstCompletion.event.version,
    "CANCEL_PLANNED_OPERATION",
    {
      planId: firstOccurrence.id,
      planExpectedVersion: firstOccurrence.version,
    },
    skipCommandId,
  );
  const skipped = await send(actors.director, skipEnvelope);
  const duplicateSkip = await send(actors.director, skipEnvelope);
  if (!duplicateSkip.duplicate || duplicateSkip.event.version !== skipped.event.version) {
    throw new Error("Idempotentes Überspringen wurde nicht als Duplikat bestätigt.");
  }
  current = await board(actors.director);
  const resetAfterSkip = current.recurringOperationalRules.find(
    (rule) => rule.id === aircraftRuleId,
  );
  if (resetAfterSkip?.progressValue !== 0 || resetAfterSkip.openPlannedOperationId !== null) {
    throw new Error("Überspringen hat den Regelzähler nicht auditiert zurückgesetzt.");
  }

  const secondCompletion = await flyOneRotation(skipped.event.version);
  current = await board(actors.director);
  const secondOccurrence = current.plannedOperations.find(
    (plan) => plan.recurringRuleId === aircraftRuleId && plan.recurrenceSequence === 2,
  );
  if (secondOccurrence?.status !== "DUE") {
    throw new Error("Zweite eindeutige Regelfälligkeit fehlt.");
  }
  const refueling = await send(
    actors.director,
    commandEnvelope(
      actors.director,
      secondCompletion.event.version,
      "SET_AIRCRAFT_OPERATIONAL_STATE",
      {
        aircraftId: "aircraft-a",
        state: "REFUELING",
        reason: "Fälligen Tankvorgang starten",
        expectedReviewAt: null,
        plannedOperationId: secondOccurrence.id,
      },
    ),
  );
  const finishCommandId = randomUUID();
  const finishEnvelope = commandEnvelope(
    actors.director,
    refueling.event.version,
    "SET_AIRCRAFT_OPERATIONAL_STATE",
    {
      aircraftId: "aircraft-a",
      state: "AVAILABLE",
      reason: "Fälligen Tankvorgang abschließen",
      expectedReviewAt: null,
      plannedOperationId: secondOccurrence.id,
    },
    finishCommandId,
  );
  const finished = await send(actors.director, finishEnvelope);
  const duplicateFinish = await send(actors.director, finishEnvelope);
  if (!duplicateFinish.duplicate || duplicateFinish.event.version !== finished.event.version) {
    throw new Error("Doppelter Abschluss wurde nicht idempotent beantwortet.");
  }
  current = await board(actors.director);
  const resetAfterCompletion = current.recurringOperationalRules.find(
    (rule) => rule.id === aircraftRuleId,
  );
  const clearedOccurrence = current.plannedOperations.find(
    (plan) => plan.id === secondOccurrence.id,
  );
  if (
    resetAfterCompletion?.progressValue !== 0 ||
    resetAfterCompletion.openPlannedOperationId !== null ||
    clearedOccurrence?.status !== "CLEARED"
  ) {
    throw new Error("Bestätigter Abschluss hat Regel oder Planeintrag nicht zurückgesetzt.");
  }

  const pilotRuleCreated = await send(
    actors.director,
    commandEnvelope(actors.director, finished.event.version, "UPSERT_RECURRING_OPERATIONAL_RULE", {
      ruleId: pilotRuleId,
      ruleExpectedVersion: null,
      rule: {
        scopeType: "PILOT",
        scopeId: "550e8400-e29b-41d4-a716-446655440100",
        kind: "PAUSE",
        triggerMetric: "OPERATING_MINUTES",
        intervalValue: 1_000,
        minimumDurationMinutes: 10,
        typicalDurationMinutes: 15,
        maximumDurationMinutes: 20,
      },
      reason: "Pilotencode-Pause nach Betriebsminuten",
    }),
  );
  const disabled = await send(
    actors.director,
    commandEnvelope(
      actors.director,
      pilotRuleCreated.event.version,
      "DISABLE_RECURRING_OPERATIONAL_RULE",
      {
        ruleId: pilotRuleId,
        ruleExpectedVersion: 0,
        reason: "Synthetische Tagesregel deaktivieren",
      },
    ),
  );
  current = await board(actors.director);
  const disabledRule = current.recurringOperationalRules.find((rule) => rule.id === pilotRuleId);
  if (disabledRule?.status !== "DISABLED") {
    throw new Error("Deaktivierte Regel bleibt nicht nachvollziehbar erhalten.");
  }

  const ruleHistory = await history(aircraftRuleId);
  const eventTypes = ruleHistory.entries.map((entry) => entry.eventType);
  const allEventTypes = (await history()).entries.map((entry) => entry.eventType);
  if (
    !eventTypes.includes("RECURRING_OPERATIONAL_RULE_CREATED") ||
    eventTypes.filter((eventType) => eventType === "RECURRING_OPERATION_DUE").length !== 2 ||
    !allEventTypes.includes("RECURRING_OPERATION_OCCURRENCE_SKIPPED")
  ) {
    throw new Error("Auditfolge für Anlage, Fälligkeiten und Überspringen ist unvollständig.");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      requirements: ["F-FLT-050", "F-FLT-060", "F-FLT-090", "F-PRG-030"],
      roleRejected: true,
      createReplayIdempotent: true,
      duplicateActiveRuleRejected: true,
      staleRuleWriteRejected: true,
      occurrenceSequences: [
        firstOccurrence.recurrenceSequence,
        secondOccurrence.recurrenceSequence,
      ],
      skipReset: true,
      completionReset: true,
      duplicateCompletionIdempotent: true,
      disabledRuleRetained: true,
      auditedDueEvents: 2,
      finalVersion: disabled.event.version,
    })}\n`,
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
