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
const pin = String.fromCharCode(48).repeat(4);
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
const tokens = {
  admin: ["demo", "admin", "device", "token"].join("-"),
  cashier: ["demo", "cashier", "device", "token"].join("-"),
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
const board = async () => {
  const response = await fetch(`${base}/api/events/demo-2026/operations`, {
    headers: { "x-device-id": "technical-scaffold", "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const command = async (deviceId, token, expectedVersion, type, payload) => {
  const response = await fetch(`${base}/api/events/demo-2026/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": token },
    body: JSON.stringify({
      commandId: randomUUID(),
      eventId: "demo-2026",
      deviceId,
      expectedVersion,
      issuedAt: new Date().toISOString(),
      type,
      payload,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${type} fehlgeschlagen: ${JSON.stringify(result)}`);
  return result;
};
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const sell = (version, productId, size) =>
  command("cashier-tablet-1", tokens.cashier, version, "SELL_TICKET_GROUP", {
    productId,
    publicTicketCodes: Array.from({ length: size }, ticketCode),
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
  });
const search = async (groupId) => {
  const query = new URLSearchParams({ q: groupId });
  const response = await fetch(`${base}/api/events/demo-2026/tickets/search?${query}`, {
    headers: { "x-device-id": "cashier-tablet-1", "x-device-token": tokens.cashier },
  });
  if (!response.ok) throw new Error(`Ticketsuche fehlgeschlagen (${response.status}).`);
  return response.json();
};

try {
  await waitForWorker();
  let current = await board();
  let result = await command(
    "technical-scaffold",
    tokens.admin,
    current.event.version,
    "CONFIGURE_EVENT_PARAMETERS",
    {
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
      reason: "Synthetischer Queue-Test",
      adminPin: pin,
    },
  );
  result = await command(
    "technical-scaffold",
    tokens.admin,
    result.event.version,
    "SET_EVENT_LIFECYCLE",
    { status: "ACTIVE", reason: "Synthetischer Queue-Test", adminPin: pin },
  );

  const first = await sell(result.event.version, "panorama-20", 3);
  const second = await sell(first.event.version, "panorama-20", 1);
  const overflow = await sell(second.event.version, "panorama-20", 1);
  const otherProduct = await sell(overflow.event.version, "panorama-30", 1);
  if (first.aggregate.relatedRotationId !== second.aggregate.relatedRotationId) {
    throw new Error("Passende ganze Buchungsgruppe wurde nicht in den freien Platz aufgenommen.");
  }
  if (
    overflow.aggregate.relatedRotationId === first.aggregate.relatedRotationId ||
    otherProduct.aggregate.relatedRotationId === first.aggregate.relatedRotationId
  ) {
    throw new Error("Kapazitätsgrenze oder Produktbindung der Fluggruppe wurde verletzt.");
  }

  current = await board();
  const packed = current.rotations.find(
    (rotation) => rotation.id === first.aggregate.relatedRotationId,
  );
  const overflowRotation = current.rotations.find(
    (rotation) => rotation.id === overflow.aggregate.relatedRotationId,
  );
  const otherRotation = current.rotations.find(
    (rotation) => rotation.id === otherProduct.aggregate.relatedRotationId,
  );
  if (
    packed?.ticketCount !== 4 ||
    packed.communicationLabel !== "PAN20-101" ||
    overflowRotation?.ticketCount !== 1 ||
    otherRotation?.ticketCount !== 1
  ) {
    throw new Error("Ticketanzahl der automatisch gebildeten Fluggruppen ist inkonsistent.");
  }
  const [firstSearch, secondSearch] = await Promise.all([
    search(first.aggregate.id),
    search(second.aggregate.id),
  ]);
  const firstMatch = firstSearch.results.find(
    (entry) => entry.ticketGroupId === first.aggregate.id,
  );
  const secondMatch = secondSearch.results.find(
    (entry) => entry.ticketGroupId === second.aggregate.id,
  );
  if (
    !firstMatch?.communicationLabel ||
    firstMatch.communicationLabel !== secondMatch?.communicationLabel ||
    firstMatch.communicationLabel !== packed.communicationLabel ||
    firstMatch.groupSize !== 3 ||
    secondMatch.groupSize !== 1
  ) {
    throw new Error(
      "Stabile Kennung oder Gruppenschutz ist in der Ticketsuche nicht nachvollziehbar.",
    );
  }
  const canceledPackedGroup = await command(
    "cashier-tablet-1",
    tokens.cashier,
    otherProduct.event.version,
    "CANCEL_TICKET_GROUP",
    {
      ticketGroupId: second.aggregate.id,
      reason: "Synthetische Teilgruppen-Korrektur",
      adminPin: pin,
    },
  );
  current = await board();
  const protectedRotation = current.rotations.find(
    (rotation) => rotation.id === first.aggregate.relatedRotationId,
  );
  if (
    canceledPackedGroup.event.version !== current.event.version ||
    protectedRotation?.status !== "DRAFT" ||
    protectedRotation.ticketCount !== 3
  ) {
    throw new Error("Korrektur einer Teilgruppe hat eine andere Buchungsgruppe mitgelöst.");
  }
  console.log(
    JSON.stringify({
      ok: true,
      requirements: ["F-SLT-010", "F-SLT-020", "F-SLT-030", "F-SLT-100"],
      packedTicketCount: packed.ticketCount,
      remainingTicketsAfterPartialCancellation: protectedRotation.ticketCount,
      stableCommunicationLabel: firstMatch.communicationLabel,
      groupSizes: [firstMatch.groupSize, secondMatch.groupSize],
      overflowSeparated: true,
      differentProductSeparated: true,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
