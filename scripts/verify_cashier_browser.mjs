import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.CASHIER_BROWSER_TEST_PORT ?? "18801");
const inspectorPort = Number(process.env.CASHIER_BROWSER_INSPECTOR_PORT ?? "19801");
const baseUrl = `http://127.0.0.1:${port}`;
const outputDirectory = resolve(
  process.env.CASHIER_BROWSER_OUTPUT ?? resolve(root, ".wrangler", "cashier-browser-screenshots"),
);
const persistPath = resolve(root, ".wrangler", "cashier-browser-state");
const persistArgument = ".wrangler/cashier-browser-state";
const wrangler = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const npmCli = process.env.npm_execpath;
const cashierAccountId = "550e8400-e29b-41d4-a716-446655440201";
const pin = "123456";
let worker = null;
let workerOutput = "";

if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");

function run(command, args, errorMessage, stdio = "ignore") {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(errorMessage);
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (worker?.exitCode !== null) {
      throw new Error(`Lokaler Worker wurde beendet:\n${workerOutput.slice(-4_000)}`);
    }
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // Der isolierte Worker startet noch.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Lokaler Worker wurde nicht rechtzeitig bereit:\n${workerOutput.slice(-4_000)}`);
}

async function startWorker() {
  await rm(persistPath, { recursive: true, force: true });
  run(
    process.execPath,
    [
      wrangler,
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      persistArgument,
      "--config",
      "wrangler.jsonc",
    ],
    "Isolierte Kassen-Browserdatenbank konnte nicht migriert werden.",
  );
  run(
    process.execPath,
    [
      wrangler,
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      persistArgument,
      "--config",
      "wrangler.jsonc",
      "--file",
      "apps/worker/seed/demo.sql",
    ],
    "Isolierte Kassen-Browserdatenbank konnte nicht befüllt werden.",
  );
  run(
    process.execPath,
    [
      wrangler,
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      persistArgument,
      "--config",
      "wrangler.jsonc",
      "--command",
      "UPDATE operation_days SET status = 'ACTIVE', sale_opens_at = NULL, operations_end_at = '2099-07-30T20:00:00.000Z' WHERE id = 'demo-2026'",
    ],
    "Synthetische Veranstaltung konnte nicht für den Browser-Verkauf aktiviert werden.",
  );
  run(
    process.execPath,
    [npmCli, "run", "build:web"],
    "Web-Build für die Kassen-Browserabnahme ist fehlgeschlagen.",
  );
  worker = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--config",
      "wrangler.jsonc",
      "--var",
      "APP_ENV:development",
      "--var",
      "DATA_JURISDICTION:eu",
      "--persist-to",
      persistArgument,
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  for (const stream of [worker.stdout, worker.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      workerOutput = `${workerOutput}${chunk}`.slice(-12_000);
    });
  }
  await waitForWorker();
}

function stopWorker() {
  if (!worker?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(worker.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    worker.kill("SIGTERM");
  }
}

async function openCashier(context, authenticate = true) {
  if (authenticate) {
    const login = await context.request.post(`${baseUrl}/api/auth/login`, {
      data: { accountId: cashierAccountId, pin },
    });
    if (!login.ok()) throw new Error(`Kassenanmeldung lieferte HTTP ${login.status()}.`);
  }
  const page = await context.newPage();
  await page.goto(`${baseUrl}/kasse`, { waitUntil: "networkidle" });
  const openEvent = page.getByRole("button", { name: "Veranstaltung öffnen" });
  if (await openEvent.isVisible()) {
    await page.locator("select").selectOption("demo-2026");
    await openEvent.click();
  }
  await page.getByRole("heading", { name: "Tickets verkaufen" }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
  return page;
}

async function assertIconControls(page) {
  for (const label of ["Gruppengröße auf 1 zurücksetzen", "Kassenreihenfolge bearbeiten"]) {
    const button = page.getByRole("button", { name: label });
    const box = await button.boundingBox();
    if (!box || box.width < 44 || box.height < 44) {
      throw new Error(`${label} unterschreitet das 44-px-Ziel: ${JSON.stringify(box)}`);
    }
    if ((await button.innerText()).trim() !== "") {
      throw new Error(`${label} wird nicht ausschließlich als Symbol dargestellt.`);
    }
    if ((await button.getAttribute("title")) !== label) {
      throw new Error(`${label} besitzt keinen identischen Tooltip.`);
    }
  }
}

async function assertOrderEditor(page) {
  const orderButton = page.getByRole("button", { name: "Kassenreihenfolge bearbeiten" });
  await orderButton.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Kassen-Reihenfolge" }).waitFor();
  if ((await page.getByRole("button", { name: /Ticket.*verkaufen/ }).count()) !== 0) {
    throw new Error("Der Verkauf bleibt im Reihenfolge-Edit-Modus bedienbar.");
  }
  const rows = page.locator(".cashier-order-row");
  if ((await rows.count()) < 2) throw new Error("Zu wenige Produkte für die Reihenfolgeprüfung.");
  const save = page.getByRole("button", { name: "Speichern" });
  if (!(await save.isDisabled())) throw new Error("Unverändertes Speichern ist nicht deaktiviert.");
  await page
    .getByRole("button", { name: /nach unten verschieben/ })
    .first()
    .click();
  if (await save.isDisabled())
    throw new Error("Geänderte Reihenfolge kann nicht gespeichert werden.");
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await page.getByRole("heading", { name: "Tickets verkaufen" }).waitFor();

  await orderButton.click();
  await page
    .getByRole("button", { name: /nach unten verschieben/ })
    .first()
    .click();
  await save.click();
  await page.getByText(/Kassenreihenfolge gespeichert/).waitFor();
  await page.getByRole("heading", { name: "Tickets verkaufen" }).waitFor();
}

async function runThirtySales(page) {
  await page.evaluate(() => performance.clearMeasures());
  const receipts = [];
  page.on("response", async (response) => {
    if (
      response.request().method() === "POST" &&
      response.url().includes("/api/control/demo-2026/commands") &&
      response.ok()
    ) {
      const body = await response.json().catch(() => null);
      if (body?.eventType === "TICKET_GROUP_SOLD" && body.saleReceipt) {
        receipts.push(body.saleReceipt.communicationLabel);
      }
    }
  });
  const saleButton = page.getByRole("button", { name: /1 Ticket für .* verkaufen/ }).first();
  for (let index = 1; index <= 30; index += 1) {
    await saleButton.click();
    try {
      await page.waitForFunction(
        (minimum) => performance.getEntriesByName("rundflug:cashier-sale-ready").length >= minimum,
        index,
        { timeout: 2_000 },
      );
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        body: document.body.innerText.slice(0, 1_500),
        readyMeasures: performance.getEntriesByName("rundflug:cashier-sale-ready").length,
      }));
      await page.screenshot({
        path: resolve(outputDirectory, `cashier-sale-failure-${index}.png`),
        fullPage: false,
      });
      throw new Error(
        `Verkauf ${index} wurde nicht rechtzeitig wieder freigegeben: ${JSON.stringify(diagnostics)}`,
        { cause: error },
      );
    }
  }
  await page.waitForFunction(
    () => performance.getEntriesByName("rundflug:cashier-sale-synchronized").length >= 30,
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    (minimum) => document.querySelectorAll(".cashier-ticket-paper img").length >= minimum,
    1,
  );

  const measurements = await page.evaluate(() => ({
    ready: performance
      .getEntriesByName("rundflug:cashier-sale-ready")
      .slice(-30)
      .map((entry) => entry.duration),
    qr: performance
      .getEntriesByName("rundflug:cashier-sale-qr")
      .slice(-30)
      .map((entry) => entry.duration),
    synchronized: performance
      .getEntriesByName("rundflug:cashier-sale-synchronized")
      .slice(-30)
      .map((entry) => entry.duration),
  }));
  if (
    measurements.ready.length !== 30 ||
    measurements.qr.length !== 30 ||
    measurements.synchronized.length !== 30
  ) {
    throw new Error(`Unvollständige Kassenmessung: ${JSON.stringify(measurements)}`);
  }
  if (Math.max(...measurements.ready) >= 1_000) {
    throw new Error(
      `Nächster Verkauf nicht innerhalb einer Sekunde bereit: ${JSON.stringify(measurements.ready)}`,
    );
  }
  if (Math.max(...measurements.synchronized) >= 2_000) {
    throw new Error(
      `Vollständige Kassenansicht nicht innerhalb von zwei Sekunden: ${JSON.stringify(measurements.synchronized)}`,
    );
  }
  const latestReceipt = receipts.at(-1);
  const receiptAlt = await page.locator(".cashier-ticket-paper img").getAttribute("alt");
  if (!latestReceipt || !receiptAlt?.includes(latestReceipt)) {
    throw new Error(
      `Der neueste Beleg wurde von älterer Hintergrundarbeit überschrieben: ${JSON.stringify({ latestReceipt, receiptAlt })}`,
    );
  }
  return measurements;
}

async function assertFailedBackgroundSyncStaysSold(page) {
  await page.route("**/api/control/demo-2026/tickets/search**", (route) => route.abort());
  const saleButton = page.getByRole("button", { name: /1 Ticket für .* verkaufen/ }).first();
  await saleButton.click();
  await page
    .getByText(/verkauft\. Ansicht oder Druckvorbereitung wird weiter nachgeladen/)
    .waitFor({
      timeout: 5_000,
    });
  if ((await page.locator("body").innerText()).includes("Verkauf fehlgeschlagen")) {
    throw new Error(
      "Fehlerhafte Nachsynchronisation stellt den bestätigten Verkauf als fehlgeschlagen dar.",
    );
  }
  await page.unroute("**/api/control/demo-2026/tickets/search**");
}

async function captureViewport(browser, viewport, colorScheme, storageState) {
  const context = await browser.newContext({
    viewport,
    colorScheme,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    storageState,
  });
  try {
    const page = await openCashier(context, false);
    await assertIconControls(page);
    const noticeCloseButtons = page.getByRole("button", { name: "Meldung schließen" });
    while ((await noticeCloseButtons.count()) > 0) {
      await noticeCloseButtons.first().click();
    }
    const geometry = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    if (geometry.documentWidth > geometry.innerWidth || geometry.bodyWidth > geometry.innerWidth) {
      throw new Error(`Horizontales Überlaufen: ${JSON.stringify(geometry)}`);
    }
    const actionAlignment = await page.locator(".cashier-group-size").evaluate((groupSize) => {
      const actions = groupSize.querySelector(".cashier-group-actions");
      const stepper = groupSize.querySelector(".cashier-stepper");
      const reset = groupSize.querySelector(".cashier-size-reset");
      if (
        !(actions instanceof HTMLElement) ||
        !(stepper instanceof HTMLElement) ||
        !(reset instanceof HTMLElement)
      ) {
        return null;
      }
      return {
        groupRight: groupSize.getBoundingClientRect().right,
        actionsRight: actions.getBoundingClientRect().right,
        stepperRight: stepper.getBoundingClientRect().right,
        resetLeft: reset.getBoundingClientRect().left,
      };
    });
    if (
      actionAlignment === null ||
      Math.abs(actionAlignment.groupRight - actionAlignment.actionsRight) > 1
    ) {
      throw new Error(`Kassenaktionen sind nicht rechtsbündig: ${JSON.stringify(actionAlignment)}`);
    }
    if (actionAlignment.resetLeft - actionAlignment.stepperRight > 9) {
      throw new Error(
        `Stepper und Reset sind nicht kompakt gruppiert: ${JSON.stringify(actionAlignment)}`,
      );
    }
    await page.screenshot({
      path: resolve(
        outputDirectory,
        `cashier-${viewport.width}x${viewport.height}-${colorScheme}.png`,
      ),
      fullPage: false,
    });
    await page.getByRole("button", { name: "Kassenreihenfolge bearbeiten" }).click();
    await page.getByRole("heading", { name: "Kassen-Reihenfolge" }).waitFor();
    await page.screenshot({
      path: resolve(
        outputDirectory,
        `cashier-order-${viewport.width}x${viewport.height}-${colorScheme}.png`,
      ),
      fullPage: false,
    });
  } finally {
    await context.close();
  }
}

await mkdir(outputDirectory, { recursive: true });
await startWorker();
let browser;
try {
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  });
  const errors = [];
  const failedResources = [];
  const page = await openCashier(context);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
  });
  await assertIconControls(page);
  await assertOrderEditor(page);
  const measurements = await runThirtySales(page);
  await assertFailedBackgroundSyncStaysSold(page);
  const unexpectedResources = failedResources.filter(
    (entry) =>
      !/^404 .*\/api\/public\/events\/[^/]+\/logo\?theme=/.test(entry) &&
      !/^503 .*\/api\/public\/push\/config$/.test(entry),
  );
  const unexpectedErrors = errors.filter(
    (entry) => !entry.startsWith("Failed to load resource:") && !entry.includes("ERR_FAILED"),
  );
  if (unexpectedErrors.length > 0 || unexpectedResources.length > 0) {
    throw new Error(
      `Browserfehler: ${unexpectedErrors.join(" | ")}; Ressourcen: ${unexpectedResources.join(" | ")}`,
    );
  }
  const storageState = await context.storageState();
  await context.close();

  for (const colorScheme of ["light", "dark"]) {
    await captureViewport(browser, { width: 1440, height: 1000 }, colorScheme, storageState);
    await captureViewport(browser, { width: 1024, height: 768 }, colorScheme, storageState);
    await captureViewport(browser, { width: 430, height: 900 }, colorScheme, storageState);
  }

  const summarize = (values) => ({
    median: Number(values.toSorted((left, right) => left - right)[14].toFixed(1)),
    maximum: Number(Math.max(...values).toFixed(1)),
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      sales: 30,
      nextSaleReadyMs: summarize(measurements.ready),
      qrMs: summarize(measurements.qr),
      fullySynchronizedMs: summarize(measurements.synchronized),
      iconControlsAtLeast44Px: true,
      rightAlignedActionsVerified: true,
      groupedStepperAndResetVerified: true,
      keyboardAndArrowReorderVerified: true,
      cancelAndSaveVerified: true,
      latestReceiptSequenceVerified: true,
      failedBackgroundSyncRemainsSold: true,
      viewports: [
        "1440x1000-light",
        "1440x1000-dark",
        "1024x768-light",
        "1024x768-dark",
        "430x900-light",
        "430x900-dark",
      ],
      outputDirectory,
    })}\n`,
  );
} finally {
  await browser?.close();
  stopWorker();
}
