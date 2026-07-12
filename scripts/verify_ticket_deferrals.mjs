import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);

const base = "http://127.0.0.1:8787";
const eventId = "demo-2026";
const actors = {
  admin: {
    id: "technical-scaffold",
    token: ["demo", "admin", "device", "token"].join("-"),
  },
  cashier: {
    id: "cashier-tablet-1",
    token: ["demo", "cashier", "device", "token"].join("-"),
  },
  flightLine: {
    id: "flight-line-tablet-1",
    token: ["demo", "flight", "line", "device", "token"].join("-"),
  },
};

const waitForWorker = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Lokaler Worker wurde nicht rechtzeitig bereit.");
};

const command = async (actor, version, type, payload) => {
  const response = await fetch(`${base}/api/events/${eventId}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": actors[actor].token },
    body: JSON.stringify({
      commandId: randomUUID(),
      eventId,
      deviceId: actors[actor].id,
      expectedVersion: version,
      issuedAt: new Date().toISOString(),
      type,
      payload,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${type} wurde abgewiesen: ${JSON.stringify(body)}`);
  return body;
};

const board = async () => {
  const response = await fetch(`${base}/api/events/${eventId}/operations`, {
    headers: {
      "x-device-id": actors.flightLine.id,
      "x-device-token": actors.flightLine.token,
    },
  });
  if (!response.ok) throw new Error(`Leitstand konnte nicht geladen werden (${response.status}).`);
  return response.json();
};

const history = async (groupId) => {
  const query = new URLSearchParams({ aggregateType: "TICKET_GROUP", aggregateId: groupId });
  const response = await fetch(`${base}/api/events/${eventId}/history?${query}`, {
    headers: { "x-device-id": actors.admin.id, "x-device-token": actors.admin.token },
  });
  if (!response.ok) throw new Error(`Historie konnte nicht geladen werden (${response.status}).`);
  return response.json();
};

const search = async (groupId) => {
  const response = await fetch(
    `${base}/api/events/${eventId}/tickets/search?q=${encodeURIComponent(groupId)}`,
    {
      headers: { "x-device-id": actors.cashier.id, "x-device-token": actors.cashier.token },
    },
  );
  if (!response.ok)
    throw new Error(`Kassensuche konnte nicht geladen werden (${response.status}).`);
  return response.json();
};

const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");

try {
  await waitForWorker();
  let current = await board();
  let result = await command("admin", current.event.version, "CONFIGURE_EVENT_PARAMETERS", {
    saleOpensAt: null,
    operationsEndAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    noShowAfterMinutes: 10,
    maxTicketDeferrals: 2,
    notificationLeadMinutes: 20,
    childReferenceWeightKg: 35,
    normalReferenceWeightKg: 80,
    heavyReferenceWeightKg: 110,
    plannedBoardingMinutes: 5,
    plannedDeboardingMinutes: 5,
    plannedBufferMinutes: 5,
    reason: "Synthetischer Zurückstellungstest",
    adminPin: pin,
  });
  result = await command("admin", result.event.version, "SET_EVENT_LIFECYCLE", {
    status: "ACTIVE",
    reason: "Synthetischer Zurückstellungstest",
    adminPin: pin,
  });
  const sold = await command("cashier", result.event.version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicTicketCodes: [ticketCode(), ticketCode()],
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
  });
  const groupId = sold.aggregate.id;
  const first = await command("flightLine", sold.event.version, "DEFER_TICKET_GROUP", {
    ticketGroupId: groupId,
    reason: "Erste synthetische Zurückstellung",
  });
  current = await board();
  const firstRotation = current.rotations.find((rotation) => rotation.ticketGroupId === groupId);
  if (
    firstRotation?.deferralCount !== 1 ||
    firstRotation.tickets.some((ticket) => ticket.status !== "QUEUED")
  ) {
    throw new Error("Erste Zurückstellung wurde nicht gezählt und neu eingereiht.");
  }

  await command("flightLine", first.event.version, "DEFER_TICKET_GROUP", {
    ticketGroupId: groupId,
    reason: "Zweite synthetische Zurückstellung",
  });
  current = await board();
  if (current.rotations.some((rotation) => rotation.ticketGroupId === groupId)) {
    throw new Error("Klärungsfall blieb unzulässig in der operativen Flight-Line-Queue.");
  }
  const found = await search(groupId);
  if (found.results[0]?.groupStatus !== "CLARIFICATION") {
    throw new Error(`Kasse sieht den Klärungsfall nicht: ${JSON.stringify(found)}`);
  }
  const ledger = await history(groupId);
  const deferrals = ledger.entries
    .filter((entry) => entry.eventType === "TICKET_GROUP_DEFERRED")
    .toSorted((left, right) => left.sequence - right.sequence);
  if (
    deferrals.length !== 2 ||
    deferrals[0].payload.deferralCount !== 1 ||
    deferrals[0].payload.requiresCashierClarification !== false ||
    deferrals[1].payload.deferralCount !== 2 ||
    deferrals[1].payload.maxTicketDeferrals !== 2 ||
    deferrals[1].payload.requiresCashierClarification !== true
  ) {
    throw new Error(
      "Zurückstellungszähler oder Klärungsentscheidung ist nicht vollständig auditiert.",
    );
  }

  process.stdout.write(
    JSON.stringify({
      configuredMaximum: 2,
      firstDeferralRequeued: true,
      secondDeferralRequiresCashierClarification: true,
      removedFromFlightLineQueue: true,
      visibleInCashierSearch: true,
      appendOnlyAuditEntries: deferrals.length,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
