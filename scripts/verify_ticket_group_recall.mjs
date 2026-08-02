import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const persistPath = mkdtempSync(join(tmpdir(), "rundflug-ticket-group-recall-"));
const persistArgument = persistPath;
const port = 10_000 + (process.pid % 50_000);
process.on("exit", () =>
  rmSync(persistPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  }),
);
const eventId = "demo-2026";
const gateId = "demo-2026-gate-main";
const adminPin = "0000";
const actors = {
  admin: { id: "technical-scaffold", token: "demo-admin-device-token" },
  cashier: { id: "cashier-tablet-1", token: "demo-cashier-device-token" },
  flightLine: { id: "flight-line-tablet-1", token: "demo-flight-line-device-token" },
};
const localD1Arguments = ["--local", "--persist-to", persistArgument, "--config", "wrangler.jsonc"];

const migrate = spawnSync(
  process.execPath,
  [wranglerCli, "d1", "migrations", "apply", "DB", ...localD1Arguments],
  { cwd: root, encoding: "utf8" },
);
if (migrate.status !== 0) {
  throw new Error(`Nachruf-Testdatenbank konnte nicht migriert werden: ${migrate.stderr}`);
}
const seed = spawnSync(
  process.execPath,
  [wranglerCli, "d1", "execute", "DB", "--file", "apps/worker/seed/demo.sql", ...localD1Arguments],
  { cwd: root, encoding: "utf8" },
);
if (seed.status !== 0) {
  throw new Error(`Nachruf-Testdatenbank konnte nicht befüllt werden: ${seed.stderr}`);
}

const server = spawn(
  process.execPath,
  [
    wranglerCli,
    "dev",
    "--config",
    "wrangler.jsonc",
    "--var",
    "APP_ENV:development",
    "--var",
    "DATA_JURISDICTION:eu",
    "--var",
    `ADMIN_PIN_HASH:${createHash("sha256").update(adminPin).digest("hex")}`,
    "--persist-to",
    persistArgument,
    "--port",
    String(port),
    "--inspector-port",
    String(port + 1_000),
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = `http://127.0.0.1:${port}`;
const wait = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function waitForWorker() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error("Lokaler Worker für den Nachruf wurde nicht rechtzeitig bereit.");
}

async function commandRequest(actorName, command) {
  const actor = actors[actorName];
  const response = await fetch(`${base}/api/control/${eventId}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": actor.token },
    body: JSON.stringify({
      eventId,
      deviceId: actor.id,
      issuedAt: new Date().toISOString(),
      ...command,
    }),
  });
  return { response, body: await response.json() };
}

async function command(actorName, expectedVersion, type, payload, commandId = randomUUID()) {
  const result = await commandRequest(actorName, {
    commandId,
    expectedVersion,
    type,
    payload,
  });
  if (!result.response.ok) {
    throw new Error(`${type} wurde abgewiesen: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function loadOperations() {
  const response = await fetch(`${base}/api/control/${eventId}/operations`, {
    headers: {
      "x-device-id": actors.flightLine.id,
      "x-device-token": actors.flightLine.token,
    },
  });
  if (!response.ok) throw new Error(`Leitstand nicht lesbar (${response.status}).`);
  return response.json();
}

async function loadJson(path) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${base}${path}${separator}recall-test=${Date.now()}`);
  if (!response.ok) throw new Error(`${path} nicht lesbar (${response.status}).`);
  return response.json();
}

async function subscribe(path, endpoint) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      consent: true,
      endpoint,
      keys: { p256dh: "synthetic-p256dh", auth: "synthetic-auth" },
    }),
  });
  if (!response.ok) {
    throw new Error(`Synthetische Push-Einwilligung abgewiesen: ${await response.text()}`);
  }
}

const groupOne = {
  publicGroupCode: "RECALLGROUPA22",
  publicTicketCode: "RECALLTICKETA22",
};
const groupTwo = {
  publicGroupCode: "RECALLGROUPB22",
  publicTicketCode: "RECALLTICKETB22",
};

let groupOneId;
let groupTwoId;
let firstRecallId;
let secondRecallId;
let groupTwoRecallId;
let auditEntries;
try {
  await waitForWorker();
  let board = await loadOperations();
  let result = await command("admin", board.event.version, "CONFIGURE_EVENT_PARAMETERS", {
    saleOpensAt: null,
    operationsEndAt: new Date(Date.now() + 8 * 60 * 60 * 1_000).toISOString(),
    noShowAfterMinutes: 10,
    maxTicketDeferrals: 2,
    notificationLeadMinutes: 20,
    childReferenceWeightKg: 35,
    normalReferenceWeightKg: 80,
    heavyReferenceWeightKg: 110,
    plannedBoardingMinutes: 5,
    plannedDeboardingMinutes: 5,
    plannedBufferMinutes: 5,
    reason: "Synthetischer Nachruftest",
    adminPin,
  });
  result = await command("admin", result.event.version, "SET_EVENT_LIFECYCLE", {
    status: "ACTIVE",
    reason: "Synthetischer Nachruftest",
    adminPin,
  });
  const soldOne = await command("cashier", result.event.version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicGroupCode: groupOne.publicGroupCode,
    publicTicketCodes: [groupOne.publicTicketCode],
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
  });
  groupOneId = soldOne.aggregate.id;
  const soldTwo = await command("cashier", soldOne.event.version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicGroupCode: groupTwo.publicGroupCode,
    publicTicketCodes: [groupTwo.publicTicketCode],
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
  });
  groupTwoId = soldTwo.aggregate.id;

  await Promise.all([
    subscribe(
      `/api/public/tickets/${groupOne.publicTicketCode}/push-subscriptions`,
      "https://fcm.googleapis.com/fcm/send/recall-group-one-ticket",
    ),
    subscribe(
      `/api/public/groups/${groupOne.publicGroupCode}/push-subscriptions`,
      "https://fcm.googleapis.com/fcm/send/recall-group-one-group",
    ),
    subscribe(
      `/api/public/tickets/${groupTwo.publicTicketCode}/push-subscriptions`,
      "https://fcm.googleapis.com/fcm/send/recall-group-two-ticket",
    ),
  ]);

  board = await loadOperations();
  const queueBefore = board.queueGroups.find((group) => group.id === groupOneId);
  const forbidden = await commandRequest("cashier", {
    commandId: randomUUID(),
    expectedVersion: board.event.version,
    type: "START_TICKET_GROUP_RECALL",
    payload: { ticketGroupId: groupOneId },
  });
  if (forbidden.response.status !== 403) {
    throw new Error(`Kassenrolle durfte Nachruf starten: ${JSON.stringify(forbidden.body)}`);
  }

  const idempotentCommandId = randomUUID();
  const firstStart = await command(
    "flightLine",
    board.event.version,
    "START_TICKET_GROUP_RECALL",
    { ticketGroupId: groupOneId },
    idempotentCommandId,
  );
  firstRecallId = firstStart.aggregate.id;
  const duplicateStart = await command(
    "flightLine",
    board.event.version,
    "START_TICKET_GROUP_RECALL",
    { ticketGroupId: groupOneId },
    idempotentCommandId,
  );
  if (duplicateStart.duplicate !== true || duplicateStart.aggregate.id !== firstRecallId) {
    throw new Error("Wiederholtes Nachrufkommando war nicht idempotent.");
  }

  board = await loadOperations();
  const queueDuringRecall = board.queueGroups.find((group) => group.id === groupOneId);
  if (
    !queueBefore ||
    !queueDuringRecall?.activeRecall ||
    queueDuringRecall.queueSequence !== queueBefore.queueSequence ||
    queueDuringRecall.status !== queueBefore.status ||
    queueDuringRecall.presentCount !== queueBefore.presentCount
  ) {
    throw new Error("Nachruf hat Queue oder Anwesenheit verändert.");
  }
  if (
    Date.parse(queueDuringRecall.activeRecall.expiresAt) -
      Date.parse(queueDuringRecall.activeRecall.startedAt) !==
    300_000
  ) {
    throw new Error("Nachruf besitzt nicht die erwartete Ablaufzeit.");
  }

  const [ticketProjection, groupProjection, fidsProjection] = await Promise.all([
    loadJson(`/api/public/tickets/${groupOne.publicTicketCode}`),
    loadJson(`/api/public/groups/${groupOne.publicGroupCode}`),
    loadJson(`/api/public/events/${eventId}/board?gateId=${gateId}`),
  ]);
  const fidsGroup = fidsProjection.groups.find((group) => group.activeRecall?.id === firstRecallId);
  if (
    ticketProjection.activeRecall?.id !== firstRecallId ||
    groupProjection.activeRecall?.id !== firstRecallId ||
    !fidsGroup ||
    !fidsGroup.activeRecall.fidsMessage.startsWith("NACHRUF · G-PAN20-")
  ) {
    throw new Error("Nachruf fehlt in Ticket-, Gruppen- oder FIDS-Projektion.");
  }

  const concurrentVersion = board.event.version;
  const parallelStarts = await Promise.all([
    commandRequest("flightLine", {
      commandId: randomUUID(),
      expectedVersion: concurrentVersion,
      type: "START_TICKET_GROUP_RECALL",
      payload: { ticketGroupId: groupTwoId },
    }),
    commandRequest("flightLine", {
      commandId: randomUUID(),
      expectedVersion: concurrentVersion,
      type: "START_TICKET_GROUP_RECALL",
      payload: { ticketGroupId: groupTwoId },
    }),
  ]);
  const accepted = parallelStarts.filter((entry) => entry.response.ok);
  const rejected = parallelStarts.filter((entry) => entry.response.status === 409);
  if (accepted.length !== 1 || rejected.length !== 1) {
    throw new Error(`Parallele Starts inkonsistent: ${JSON.stringify(parallelStarts)}`);
  }
  groupTwoRecallId = accepted[0].body.aggregate.id;

  board = await loadOperations();
  await command("flightLine", board.event.version, "CLEAR_TICKET_GROUP_RECALL", {
    ticketGroupId: groupOneId,
    recallId: firstRecallId,
  });
  board = await loadOperations();
  const secondStart = await command(
    "flightLine",
    board.event.version,
    "START_TICKET_GROUP_RECALL",
    { ticketGroupId: groupOneId },
  );
  secondRecallId = secondStart.aggregate.id;
  board = await loadOperations();
  const secondActive = board.queueGroups.find((group) => group.id === groupOneId)?.activeRecall;
  if (secondActive?.sequence !== 2 || secondActive.id !== secondRecallId) {
    throw new Error("Erneuter Nachruf erhielt keine neue ID und Sequenz.");
  }
  await command("flightLine", board.event.version, "SET_TICKET_GROUP_ATTENDANCE", {
    ticketGroupId: groupOneId,
    checkedIn: true,
  });
  board = await loadOperations();
  if (board.queueGroups.find((group) => group.id === groupOneId)?.activeRecall !== null) {
    throw new Error("Anwesenheitsbestätigung beendete den Nachruf nicht automatisch.");
  }
  await command("flightLine", board.event.version, "CLEAR_TICKET_GROUP_RECALL", {
    ticketGroupId: groupTwoId,
    recallId: groupTwoRecallId,
  });
  await wait(500);

  const historyResponse = await fetch(`${base}/api/control/${eventId}/history?limit=100`, {
    headers: {
      "x-device-id": actors.admin.id,
      "x-device-token": actors.admin.token,
    },
  });
  if (!historyResponse.ok) throw new Error("Nachruf-Audit nicht lesbar.");
  const history = await historyResponse.json();
  auditEntries = history.entries.filter((entry) =>
    ["TICKET_GROUP_RECALL_STARTED", "TICKET_GROUP_RECALL_CLEARED"].includes(entry.eventType),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}

const query = spawnSync(
  process.execPath,
  [
    wranglerCli,
    "d1",
    "execute",
    "DB",
    ...localD1Arguments,
    "--command",
    `SELECT recall.ticket_group_id, recall.sequence, recall.end_reason,
            COUNT(delivery.id) AS delivery_count,
            SUM(CASE WHEN subscription.ticket_group_id <> recall.ticket_group_id THEN 1 ELSE 0 END)
              AS wrong_group_count
       FROM ticket_group_recalls recall
       LEFT JOIN web_push_deliveries delivery
         ON delivery.ticket_group_recall_id = recall.id
       LEFT JOIN web_push_subscriptions subscription
         ON subscription.id = delivery.subscription_id
      GROUP BY recall.id
      ORDER BY recall.ticket_group_id, recall.sequence;
     SELECT COUNT(*) AS count
       FROM outbox
      WHERE operation_day_id = '${eventId}'
        AND json_extract(payload_json, '$.aggregate.type') = 'TICKET_GROUP_RECALL';`,
    "--json",
  ],
  { cwd: root, encoding: "utf8" },
);
if (query.status !== 0) {
  throw new Error(`Nachruf-Zustellung und Outbox nicht lesbar: ${query.stderr || query.stdout}`);
}
const queryResults = JSON.parse(query.stdout);
const recallRows = queryResults[0]?.results ?? [];
const outboxCount = queryResults[1]?.results?.[0]?.count;
const groupOneRows = recallRows.filter((row) => row.ticket_group_id === groupOneId);
const groupTwoRows = recallRows.filter((row) => row.ticket_group_id === groupTwoId);
const deliveryInvariant =
  groupOneRows.length === 2 &&
  groupOneRows.every((row) => row.delivery_count === 2 && row.wrong_group_count === 0) &&
  groupTwoRows.length === 1 &&
  groupTwoRows[0]?.delivery_count === 1 &&
  groupTwoRows[0]?.wrong_group_count === 0;
const endReasons = new Set(groupOneRows.map((row) => row.end_reason));
if (
  !deliveryInvariant ||
  !endReasons.has("MANUAL") ||
  !endReasons.has("PRESENT") ||
  groupTwoRows[0]?.end_reason !== "MANUAL" ||
  auditEntries?.length !== 6 ||
  outboxCount !== 6
) {
  throw new Error(
    `Nachruf-Invarianten fehlgeschlagen: ${JSON.stringify({
      recallRows,
      auditEntries: auditEntries?.length,
      outboxCount,
    })}`,
  );
}

console.log(
  JSON.stringify({
    ok: true,
    startAndManualClear: true,
    automaticClearOnPresence: true,
    idempotentDuplicate: true,
    concurrentStartConflict: true,
    fixedExpiryMilliseconds: 300_000,
    secondRecallQueuedPushAgain: true,
    groupSpecificDeliveries: recallRows.map((row) => ({
      sequence: row.sequence,
      deliveryCount: row.delivery_count,
      wrongGroupCount: row.wrong_group_count,
    })),
    publicAndFidsProjection: true,
    cashierForbidden: true,
    auditEntries: auditEntries.length,
    outboxEntries: outboxCount,
  }),
);
