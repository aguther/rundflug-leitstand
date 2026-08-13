import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { WINDOWS_TASKKILL_EXECUTABLE } from "./lib/tool-executables.mjs";

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
const tabletLandscapeMediaQuery =
  "(min-width: 1101px) and (max-width: 1250px) and (max-height: 900px) and (orientation: landscape) and (any-pointer: coarse)";
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
    spawnSync(WINDOWS_TASKKILL_EXECUTABLE, ["/pid", String(worker.pid), "/T", "/F"], {
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

function assertContained(inner, outer, label, tolerance = 1) {
  if (
    inner.left < outer.left - tolerance ||
    inner.top < outer.top - tolerance ||
    inner.right > outer.right + tolerance ||
    inner.bottom > outer.bottom + tolerance
  ) {
    throw new Error(`${label} is not fully contained: ${JSON.stringify({ inner, outer })}`);
  }
}

function assertBaseViewportGeometry(geometry, scenario) {
  if (
    geometry.document.scrollWidth > geometry.document.clientWidth + 1 ||
    geometry.document.bodyScrollWidth > geometry.viewport.width + 1
  ) {
    throw new Error(`Horizontal document overflow: ${JSON.stringify(geometry.document)}`);
  }
  if (geometry.toolbar.box.bottom > geometry.ticketTable.box.top + 1) {
    throw new Error(
      `Cashier toolbar overlaps the ticket list: ${JSON.stringify({ toolbar: geometry.toolbar.box, ticketTable: geometry.ticketTable.box })}`,
    );
  }
  if (
    scenario.expectSingleScreen &&
    (geometry.document.scrollHeight > geometry.document.clientHeight + 1 ||
      geometry.document.bodyScrollHeight > geometry.viewport.height + 1)
  ) {
    throw new Error(
      `Vertical document scroll in single-screen mode: ${JSON.stringify(geometry.document)}`,
    );
  }
  if (geometry.media.tabletLandscape !== scenario.expectTabletLayout) {
    throw new Error(
      `Unexpected tablet media-query state: ${JSON.stringify({ scenario, media: geometry.media })}`,
    );
  }
}

function assertTabletHeaderGeometry(geometry) {
  if (!geometry.media.pointerCoarse || !geometry.media.anyPointerCoarse) {
    throw new Error(
      `Tablet context does not expose a coarse pointer: ${JSON.stringify(geometry.media)}`,
    );
  }
  assertContained(geometry.salePanel, geometry.viewport, "Cashier sale panel");
  assertContained(geometry.ticketPanel, geometry.viewport, "Cashier ticket panel");
  if (
    geometry.heading.scrollWidth > geometry.heading.clientWidth + 1 ||
    geometry.heading.scrollHeight > geometry.heading.clientHeight + 1 ||
    geometry.heading.box.height > geometry.heading.lineHeight * 1.5
  ) {
    throw new Error(`Cashier heading wraps or clips: ${JSON.stringify(geometry.heading)}`);
  }
  for (const [index, button] of geometry.tabs.buttons.entries()) {
    assertContained(button, geometry.tabs.box, `Cashier tab ${index + 1}`);
  }
  if (
    geometry.tabs.scrollTop !== 0 ||
    geometry.tabs.scrollHeight > geometry.tabs.clientHeight + 1
  ) {
    throw new Error(`Cashier tabs scroll vertically: ${JSON.stringify(geometry.tabs)}`);
  }
  if (
    geometry.tabs.box.bottom > geometry.toolbar.box.top + 1 ||
    geometry.tabs.activeBorderWidth < 2 ||
    geometry.tabs.activeBorderColor === "rgba(0, 0, 0, 0)"
  ) {
    throw new Error(
      `Cashier tabs overlap the toolbar or hide the active underline: ${JSON.stringify({ tabs: geometry.tabs, toolbar: geometry.toolbar })}`,
    );
  }
}

function assertTabletControlsGeometry(geometry) {
  for (const control of geometry.toolbar.controls) {
    assertContained(
      control.box,
      geometry.toolbar.box,
      `Cashier toolbar control ${control.selector}`,
    );
  }
  if (
    geometry.refreshButton.box.width < 44 ||
    geometry.refreshButton.box.height < 44 ||
    geometry.refreshButton.display === "none" ||
    geometry.refreshButton.visibility !== "visible" ||
    geometry.refreshButton.opacity === 0
  ) {
    throw new Error(
      `Cashier refresh control is not a visible 44px target: ${JSON.stringify(geometry.refreshButton)}`,
    );
  }
  for (const [index, button] of geometry.stepperButtons.entries()) {
    if (button.width < 44 || button.height < 44) {
      throw new Error(
        `Cashier stepper target ${index + 1} is below 44px: ${JSON.stringify(button)}`,
      );
    }
  }
}

function assertTabletContentGeometry(geometry) {
  if (
    geometry.ticketTable.clientHeight < 120 ||
    !["auto", "scroll"].includes(geometry.ticketTable.overflowY) ||
    geometry.ticketTable.scrollHeight <= geometry.ticketTable.clientHeight
  ) {
    throw new Error(
      `Cashier ticket list is not a usable scroll region: ${JSON.stringify(geometry.ticketTable)}`,
    );
  }
  assertContained(geometry.ticketTable.box, geometry.ticketPanel, "Cashier ticket list");
  assertContained(geometry.ticketDetail, geometry.ticketPanel, "Cashier ticket detail");
  if (geometry.ticketTable.box.bottom > geometry.ticketDetail.top + 1) {
    throw new Error(
      `Cashier ticket list overlaps the detail: ${JSON.stringify({ ticketTable: geometry.ticketTable.box, ticketDetail: geometry.ticketDetail })}`,
    );
  }
  assertContained(
    geometry.ticketDetailGrid.box,
    geometry.ticketDetail,
    "Cashier ticket detail grid",
  );
  for (const [index, child] of geometry.ticketDetailGrid.children.entries()) {
    assertContained(
      child,
      geometry.ticketDetailGrid.box,
      `Cashier ticket detail area ${index + 1}`,
    );
  }
  if (!["auto", "scroll"].includes(geometry.flightGroups.overflowY)) {
    throw new Error(
      `Cashier flight groups are not a bounded scroll region: ${JSON.stringify(geometry.flightGroups)}`,
    );
  }
  assertContained(geometry.ticketActions, geometry.ticketDetail, "Cashier ticket actions");
  const actionLabels = new Set(geometry.actionButtons.map((button) => button.label));
  for (const requiredLabel of ["Stornieren", "Ticket drucken"]) {
    if (!actionLabels.has(requiredLabel)) {
      throw new Error(`Missing visible cashier ticket action: ${requiredLabel}`);
    }
  }
  for (const [index, button] of geometry.actionButtons.entries()) {
    assertContained(button.box, geometry.viewport, `Cashier ticket action ${index + 1}`);
  }
}

async function assertViewportGeometry(page, scenario) {
  const geometry = await page.evaluate((query) => {
    const element = (selector) => {
      const match = document.querySelector(selector);
      if (!(match instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`);
      return match;
    };
    const rectangle = (target) => {
      const box = target.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const tabs = element(".cashier-ticket-panel > .ds-tabs");
    const toolbar = element(".cashier-ticket-toolbar");
    const heading = element(".cashier-sale-title h1");
    const ticketTable = element(".cashier-ticket-table-wrap");
    const ticketDetail = element(".cashier-ticket-detail");
    const ticketDetailGrid = element(".cashier-ticket-detail-grid");
    const flightGroups = element(".cashier-flight-groups");
    const refreshButton = element(".cashier-ticket-toolbar > .ds-icon-button");
    const activeTab = tabs.querySelector('[aria-selected="true"]');
    if (!(activeTab instanceof HTMLButtonElement)) throw new Error("Missing active cashier tab");

    return {
      viewport: {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      },
      document: {
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        bodyScrollWidth: document.body.scrollWidth,
        bodyScrollHeight: document.body.scrollHeight,
      },
      media: {
        tabletLandscape: window.matchMedia(query).matches,
        pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
        anyPointerCoarse: window.matchMedia("(any-pointer: coarse)").matches,
        hoverNone: window.matchMedia("(hover: none)").matches,
        anyHoverNone: window.matchMedia("(any-hover: none)").matches,
      },
      shell: rectangle(element(".cashier-shell")),
      workspace: rectangle(element(".cashier-v15-workspace")),
      salePanel: rectangle(element(".cashier-sale-panel")),
      ticketPanel: rectangle(element(".cashier-ticket-panel")),
      heading: {
        box: rectangle(heading),
        clientWidth: heading.clientWidth,
        clientHeight: heading.clientHeight,
        scrollWidth: heading.scrollWidth,
        scrollHeight: heading.scrollHeight,
        lineHeight: Number.parseFloat(getComputedStyle(heading).lineHeight),
      },
      tabs: {
        box: rectangle(tabs),
        clientHeight: tabs.clientHeight,
        scrollHeight: tabs.scrollHeight,
        scrollTop: tabs.scrollTop,
        buttons: Array.from(tabs.querySelectorAll("button"), rectangle),
        activeBorderWidth: Number.parseFloat(getComputedStyle(activeTab).borderBottomWidth),
        activeBorderColor: getComputedStyle(activeTab).borderBottomColor,
      },
      toolbar: {
        box: rectangle(toolbar),
        controls: [
          ".ds-search-field",
          ".cashier-account-filter",
          ".cashier-own-ticket-filter",
          ".ds-icon-button",
        ].map((selector) => ({
          selector,
          box: rectangle(element(`.cashier-ticket-toolbar > ${selector}`)),
        })),
      },
      refreshButton: {
        box: rectangle(refreshButton),
        visibility: getComputedStyle(refreshButton).visibility,
        display: getComputedStyle(refreshButton).display,
        opacity: Number.parseFloat(getComputedStyle(refreshButton).opacity),
      },
      stepperButtons: Array.from(document.querySelectorAll(".cashier-stepper > button"), rectangle),
      ticketTable: {
        box: rectangle(ticketTable),
        clientHeight: ticketTable.clientHeight,
        scrollHeight: ticketTable.scrollHeight,
        overflowY: getComputedStyle(ticketTable).overflowY,
      },
      ticketDetail: rectangle(ticketDetail),
      ticketDetailGrid: {
        box: rectangle(ticketDetailGrid),
        children: Array.from(ticketDetailGrid.children, rectangle),
      },
      flightGroups: {
        box: rectangle(flightGroups),
        overflowY: getComputedStyle(flightGroups).overflowY,
      },
      ticketActions: rectangle(element(".cashier-ticket-actions")),
      actionButtons: Array.from(
        document.querySelectorAll(".cashier-ticket-actions > button"),
        (button) => ({
          box: rectangle(button),
          label: button.textContent?.replace(/\s+/g, " ").trim() ?? "",
        }),
      ),
    };
  }, tabletLandscapeMediaQuery);

  assertBaseViewportGeometry(geometry, scenario);
  if (!scenario.expectTabletLayout) return geometry;
  assertTabletHeaderGeometry(geometry);
  assertTabletControlsGeometry(geometry);
  assertTabletContentGeometry(geometry);
  return geometry;
}

async function captureViewport(browser, scenario, colorScheme, storageState) {
  const { viewport, hasTouch = false } = scenario;
  const context = await browser.newContext({
    viewport,
    hasTouch,
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
    const screenshotVariant = `${viewport.width}x${viewport.height}${hasTouch ? "-touch" : "-mouse"}-${colorScheme}`;
    await page.screenshot({
      path: resolve(outputDirectory, `cashier-${screenshotVariant}.png`),
      fullPage: false,
    });
    await assertViewportGeometry(page, scenario);
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
    await page.getByRole("button", { name: "Kassenreihenfolge bearbeiten" }).click();
    await page.getByRole("heading", { name: "Kassen-Reihenfolge" }).waitFor();
    await page.screenshot({
      path: resolve(outputDirectory, `cashier-order-${screenshotVariant}.png`),
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

  const viewportScenarios = [
    {
      viewport: { width: 1440, height: 1000 },
      expectSingleScreen: true,
      expectTabletLayout: false,
    },
    {
      viewport: { width: 1920, height: 1080 },
      expectSingleScreen: true,
      expectTabletLayout: false,
    },
    { viewport: { width: 1194, height: 834 }, expectSingleScreen: true, expectTabletLayout: false },
    {
      viewport: { width: 1024, height: 768 },
      expectSingleScreen: false,
      expectTabletLayout: false,
    },
    {
      viewport: { width: 430, height: 900 },
      hasTouch: true,
      expectSingleScreen: false,
      expectTabletLayout: false,
    },
    {
      viewport: { width: 834, height: 1194 },
      hasTouch: true,
      expectSingleScreen: false,
      expectTabletLayout: false,
    },
    {
      viewport: { width: 1194, height: 700 },
      hasTouch: true,
      expectSingleScreen: true,
      expectTabletLayout: true,
    },
    {
      viewport: { width: 1194, height: 834 },
      hasTouch: true,
      expectSingleScreen: true,
      expectTabletLayout: true,
    },
    {
      viewport: { width: 1133, height: 744 },
      hasTouch: true,
      expectSingleScreen: true,
      expectTabletLayout: true,
    },
    {
      viewport: { width: 1180, height: 820 },
      hasTouch: true,
      expectSingleScreen: true,
      expectTabletLayout: true,
    },
  ];
  const verifiedViewports = [];
  for (const colorScheme of ["light", "dark"]) {
    for (const scenario of viewportScenarios) {
      const scenarioKey = `${scenario.viewport.width}x${scenario.viewport.height}${scenario.hasTouch ? "-touch" : ""}`;
      const verifyDark =
        scenario.expectTabletLayout || ["1440x1000", "430x900-touch"].includes(scenarioKey);
      if (colorScheme === "dark" && !verifyDark) continue;
      await captureViewport(browser, scenario, colorScheme, storageState);
      verifiedViewports.push(`${scenarioKey}-${colorScheme}`);
    }
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
      tabletLandscapeMediaQuery,
      tabletGeometryVerified: true,
      mouseViewportExcludesTabletLayout: true,
      viewports: verifiedViewports,
      outputDirectory,
    })}\n`,
  );
} finally {
  await browser?.close();
  stopWorker();
}
