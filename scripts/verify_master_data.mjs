import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const reset = spawnSync(process.execPath, [npmCli, "run", "db:reset:local"], {
  cwd: root,
  stdio: "ignore",
});
if (reset.status !== 0) throw new Error("Lokale Testdatenbank konnte nicht initialisiert werden.");

const pin = String.fromCharCode(48).repeat(6);
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
    `ADMIN_PIN_HASH:${createHash("sha256").update(pin).digest("hex")}`,
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = "http://127.0.0.1:8787";
const tokens = {
  admin: ["demo", "admin", "device", "token"].join("-"),
  cashier: ["demo", "cashier", "device", "token"].join("-"),
  flightLine: ["demo", "flight", "line", "device", "token"].join("-"),
};
const devices = {
  admin: "technical-scaffold",
  cashier: "cashier-tablet-1",
  flightLine: "flight-line-tablet-1",
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
const operationBoard = async (deviceId, token) => {
  const response = await fetch(`${base}/api/events/demo-2026/operations`, {
    headers: { "x-device-id": deviceId, "x-device-token": token },
  });
  if (!response.ok) throw new Error(`Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const command = async (deviceId, token, expectedVersion, type, payload, expectedStatus = 200) => {
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
  if (response.status !== expectedStatus) {
    throw new Error(`${type} lieferte ${response.status} statt ${expectedStatus}.`);
  }
  return response.json();
};
const history = async (aggregateType, aggregateId) => {
  const query = new URLSearchParams({ aggregateType, aggregateId, limit: "100" });
  const response = await fetch(`${base}/api/events/demo-2026/history?${query}`, {
    headers: { "x-device-id": devices.admin, "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Historien-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const admin = (version, type, payload, expectedStatus) =>
  command(devices.admin, tokens.admin, version, type, payload, expectedStatus);

try {
  await waitForWorker();
  let board = await operationBoard(devices.admin, tokens.admin);
  let result = await admin(board.event.version, "UPSERT_GATE", {
    gateId: "gate-delete-test",
    label: "Synthetisches Lösch-Gate",
    gateType: "DISPLAY_ONLY",
    active: true,
    sortOrder: 99,
    reason: "Synthetischer Löschtest",
    adminPin: pin,
  });
  await command(
    devices.cashier,
    tokens.cashier,
    result.event.version,
    "DELETE_MASTER_DATA",
    {
      entityType: "GATE",
      entityId: "gate-delete-test",
      reason: "Synthetischer Löschtest",
      adminPin: pin,
    },
    403,
  );
  result = await admin(result.event.version, "DELETE_MASTER_DATA", {
    entityType: "GATE",
    entityId: "gate-delete-test",
    reason: "Synthetischer Löschtest",
    adminPin: pin,
  });
  board = await operationBoard(devices.admin, tokens.admin);
  if (board.gates.some((gate) => gate.id === "gate-delete-test")) {
    throw new Error("Abhängigkeitsfreies Gate wurde in der Vorbereitung nicht gelöscht.");
  }
  const deleteHistory = await history("GATE", "gate-delete-test");
  if (!deleteHistory.entries.some((entry) => entry.eventType === "GATE_DELETED")) {
    throw new Error("Audit-Ereignis für die Stammdatenlöschung fehlt.");
  }
  result = await admin(result.event.version, "UPSERT_GATE", {
    gateId: "gate-resource-test",
    label: "Flight Line Ressourcen",
    gateType: "FLIGHT_LINE",
    active: true,
    sortOrder: 20,
    reason: "Synthetischer Stammdatentest",
    adminPin: pin,
  });
  for (const aircraft of [
    { id: "aircraft-shared-a", registration: "D-ETSA" },
    { id: "aircraft-shared-b", registration: "D-ETSB" },
  ]) {
    result = await admin(result.event.version, "UPSERT_AIRCRAFT", {
      aircraftId: aircraft.id,
      registration: aircraft.registration,
      aircraftType: "C172",
      passengerSeats: 3,
      maximumPassengerPayloadKg: 250,
      reason: "Synthetischer Stammdatentest",
      adminPin: pin,
    });
  }
  result = await admin(result.event.version, "UPSERT_RESOURCE_GROUP", {
    resourceGroupId: "resource-shared-test",
    name: "Gemeinsame Panorama-Flotte",
    gateId: "gate-resource-test",
    referenceCapacity: 3,
    plannedRotationMinutes: 35,
    compatibleAircraftTypes: [],
    aircraftIds: ["aircraft-shared-a", "aircraft-shared-b"],
    reason: "Synthetischer Stammdatentest",
    adminPin: pin,
  });
  await admin(
    result.event.version,
    "DELETE_MASTER_DATA",
    {
      entityType: "GATE",
      entityId: "gate-resource-test",
      reason: "Synthetischer Abhängigkeitstest",
      adminPin: pin,
    },
    409,
  );
  const productPayload = (id, code, name, duration, overrides = {}) => ({
    productId: id,
    resourceGroupId: "resource-shared-test",
    gateId: "gate-resource-test",
    name,
    code,
    publicDescription: "Synthetisches Produkt ohne Echtdaten",
    priceCents: duration * 200,
    referenceCapacity: 3,
    referenceDurationMinutes: duration,
    promisedFlightMinutes: duration,
    childCompanionRequired: false,
    weightClasses: ["NOT_CAPTURED"],
    sortOrder: duration,
    reason: "Synthetischer Stammdatentest",
    adminPin: pin,
    ...overrides,
  });
  result = await admin(
    result.event.version,
    "UPSERT_PRODUCT",
    productPayload("product-shared-20", "TST20", "Test Panorama 20", 20),
  );
  await admin(
    result.event.version,
    "UPSERT_PRODUCT",
    productPayload("product-invalid-weight", "INVW", "Ungültige Gewichtsklassen", 20, {
      weightClasses: ["NOT_CAPTURED", "CHILD"],
    }),
    400,
  );
  await admin(
    result.event.version,
    "UPSERT_PRODUCT",
    productPayload("product-invalid-child", "INVC", "Ungültiger Begleithinweis", 20, {
      childCompanionRequired: true,
      weightClasses: ["NORMAL"],
    }),
    400,
  );
  await admin(
    result.event.version,
    "UPSERT_PRODUCT",
    productPayload("product-invalid-reference", "INVR", "Ungültiger Bezug", 20, {
      resourceGroupId: "unknown-resource-group",
    }),
    409,
  );
  await admin(
    result.event.version,
    "UPSERT_PRODUCT",
    productPayload("product-duplicate-code", "TST20", "Doppeltes Kürzel", 20),
    409,
  );
  result = await admin(
    result.event.version,
    "UPSERT_PRODUCT",
    productPayload("product-shared-20", "TST20", "Test Panorama 20 aktualisiert", 20, {
      priceCents: 4550,
    }),
  );
  const staleVersion = result.event.version;
  result = await admin(
    result.event.version,
    "UPSERT_PRODUCT",
    productPayload("product-shared-30", "TST30", "Test Panorama 30", 30),
  );
  await admin(
    result.event.version,
    "UPSERT_GATE",
    {
      gateId: "gate-resource-test",
      label: "Flight Line Ressourcen",
      gateType: "FLIGHT_LINE",
      active: true,
      sortOrder: 20,
      displayFilter: {
        productIds: ["unknown-product"],
        rotationStatuses: ["DRAFT"],
      },
      reason: "Ungültigen synthetischen Anzeigefilter ablehnen",
      adminPin: pin,
    },
    409,
  );
  result = await admin(result.event.version, "UPSERT_GATE", {
    gateId: "gate-resource-test",
    label: "Flight Line Ressourcen",
    gateType: "FLIGHT_LINE",
    active: true,
    sortOrder: 20,
    displayFilter: {
      productIds: ["product-shared-20"],
      rotationStatuses: ["DRAFT"],
    },
    reason: "Synthetischen Gate-Anzeigefilter konfigurieren",
    adminPin: pin,
  });
  await admin(
    staleVersion,
    "UPSERT_PRODUCT",
    productPayload("product-stale", "STALE", "Veraltetes Produkt", 25),
    409,
  );
  result = await admin(result.event.version, "CONFIGURE_EVENT_PARAMETERS", {
    saleOpensAt: null,
    operationsEndAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    noShowAfterMinutes: 10,
    notificationLeadMinutes: 60,
    childReferenceWeightKg: 35,
    normalReferenceWeightKg: 80,
    heavyReferenceWeightKg: 110,
    plannedBoardingMinutes: 5,
    plannedDeboardingMinutes: 5,
    plannedBufferMinutes: 5,
    reason: "Synthetischer Stammdatentest",
    adminPin: pin,
  });
  result = await admin(result.event.version, "SET_EVENT_LIFECYCLE", {
    status: "ACTIVE",
    reason: "Synthetischer Stammdatentest",
    adminPin: pin,
  });
  await admin(
    result.event.version,
    "DELETE_MASTER_DATA",
    {
      entityType: "GATE",
      entityId: "gate-resource-test",
      reason: "Synthetischer Phasentest",
      adminPin: pin,
    },
    409,
  );
  const codes = [ticketCode(), ticketCode()];
  const firstSale = await command(
    devices.cashier,
    tokens.cashier,
    result.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "product-shared-20",
      publicTicketCodes: [codes[0]],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  );
  const secondSale = await command(
    devices.cashier,
    tokens.cashier,
    firstSale.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "product-shared-30",
      publicTicketCodes: [codes[1]],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  );
  board = await operationBoard(devices.admin, tokens.admin);
  const sharedProducts = board.products.filter(
    (product) => product.resourceGroupId === "resource-shared-test",
  );
  const updatedProduct = sharedProducts.find((product) => product.id === "product-shared-20");
  const sharedGroup = board.resourceGroups.find((group) => group.id === "resource-shared-test");
  const sharedGate = board.gates.find((gate) => gate.id === "gate-resource-test");
  if (
    sharedProducts.length !== 2 ||
    sharedProducts.some((product) => product.resourceGroupOpenTickets !== 2) ||
    updatedProduct?.name !== "Test Panorama 20 aktualisiert" ||
    updatedProduct.priceCents !== 4550 ||
    sharedGroup?.activeAircraftIds.length !== 2 ||
    sharedGroup.gateId !== "gate-resource-test" ||
    !sharedGate?.assignedResourceGroupIds.includes("resource-shared-test") ||
    sharedGate.displayFilter.productIds[0] !== "product-shared-20" ||
    sharedGate.displayFilter.rotationStatuses[0] !== "DRAFT"
  ) {
    throw new Error(
      `Gemeinsame Ressourcenkapazität oder Stammdatenbezüge sind inkonsistent: ${JSON.stringify({ sharedProducts, sharedGroup })}`,
    );
  }
  const paused = await admin(secondSale.event.version, "SET_RESOURCE_GROUP_STATUS", {
    resourceGroupId: "resource-shared-test",
    status: "PAUSED",
    reason: "Synthetische Ressourcenpause",
    expectedReviewAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  await command(
    devices.cashier,
    tokens.cashier,
    paused.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "product-shared-20",
      publicTicketCodes: [ticketCode()],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
    409,
  );
  await command(
    devices.flightLine,
    tokens.flightLine,
    paused.event.version,
    "CALL_NEXT",
    {
      rotationId: firstSale.aggregate.relatedRotationId,
      aircraftId: "aircraft-shared-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    409,
  );
  const publicStatus = await fetch(`${base}/api/public/tickets/${codes[0]}`).then((response) =>
    response.json(),
  );
  const publicBoard = await fetch(`${base}/api/public/events/demo-2026/board`).then((response) =>
    response.json(),
  );
  const gateBoard = await fetch(
    `${base}/api/public/events/demo-2026/board?gateId=gate-resource-test`,
  ).then((response) => response.json());
  if (
    publicStatus.status !== "SERVICE_PAUSED" ||
    publicStatus.predictionQuality !== "UNCERTAIN" ||
    !publicBoard.groups.some(
      (group) => group.productCode === "TST20" && group.status === "SERVICE_PAUSED",
    ) ||
    gateBoard.selectedGate?.id !== "gate-resource-test" ||
    gateBoard.groups.length !== 1 ||
    gateBoard.groups[0]?.productCode !== "TST20"
  ) {
    throw new Error("Ressourcenpause wirkt nicht ehrlich auf öffentliche Anzeigen.");
  }
  const resumed = await admin(paused.event.version, "SET_RESOURCE_GROUP_STATUS", {
    resourceGroupId: "resource-shared-test",
    status: "ACTIVE",
    reason: "Synthetische Ressourcenpause beendet",
    expectedReviewAt: null,
  });
  const resourceHistory = await history("RESOURCE_GROUP", "resource-shared-test");
  const productHistory = await history("PRODUCT", "product-shared-20");
  if (
    !resourceHistory.entries.some((entry) => entry.eventType === "RESOURCE_GROUP_UPSERTED") ||
    resourceHistory.entries.filter((entry) => entry.eventType === "RESOURCE_GROUP_STATUS_CHANGED")
      .length !== 2 ||
    !resourceHistory.entries.some(
      (entry) =>
        entry.eventType === "RESOURCE_GROUP_UPSERTED" &&
        entry.payload.aircraftIds?.includes("aircraft-shared-a") &&
        entry.payload.aircraftIds?.includes("aircraft-shared-b"),
    ) ||
    productHistory.entries.filter((entry) => entry.eventType === "PRODUCT_UPSERTED").length !== 2 ||
    !productHistory.entries.some(
      (entry) => entry.eventType === "PRODUCT_UPSERTED" && entry.payload.priceCents === 4550,
    )
  ) {
    throw new Error("Stammdaten- oder Zuordnungshistorie ist unvollständig.");
  }
  process.stdout.write(
    JSON.stringify({
      productsShareExactlyOneResourceGroup: true,
      sharedQueueDemandVisible: true,
      twoAircraftInResourceGroup: true,
      compatibilityAndGateConfigured: true,
      gateAssignmentsProjected: true,
      gateDisplayFilterAppliedPublicly: true,
      invalidGateDisplayReferenceRejected: true,
      productCreateUpdateAndAuditConfirmed: true,
      invalidProductReferencesRejected: true,
      duplicateProductCodesRejected: true,
      invalidWeightConfigurationRejected: true,
      staleMasterDataRejected: true,
      pauseBlocksSales: true,
      pauseBlocksCalls: true,
      pauseVisiblePubliclyWithoutCountdown: true,
      assignmentAndStatusAudited: true,
      finalVersion: resumed.event.version,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
