import { spawn, spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { WINDOWS_TASKKILL_EXECUTABLE } from "./lib/tool-executables.mjs";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.EVENT_SWITCH_BROWSER_TEST_PORT ?? "18811");
const inspectorPort = Number(process.env.EVENT_SWITCH_BROWSER_INSPECTOR_PORT ?? "19811");
const baseUrl = `http://127.0.0.1:${port}`;
const persistPath = resolve(root, ".wrangler", "event-switch-browser-state");
const persistArgument = ".wrangler/event-switch-browser-state";
const wrangler = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const npmCli = process.env.npm_execpath;
const adminAccountId = "550e8400-e29b-41d4-a716-446655440200";
const pin = "123456";
const firstEventId = "demo-2026";
const secondEventId = "event-switch-b";
const secondEventName = "Synthetischer Flugtag B";
let worker = null;
let workerOutput = "";

if (!npmCli) throw new Error("npm executable path is unavailable.");

function run(command, args, errorMessage) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(errorMessage);
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (worker?.exitCode !== null) {
      throw new Error(`Local worker exited unexpectedly:\n${workerOutput.slice(-4_000)}`);
    }
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // The isolated worker is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Local worker did not become ready:\n${workerOutput.slice(-4_000)}`);
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
    "Could not migrate the isolated event-switch database.",
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
    "Could not seed the isolated event-switch database.",
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
      `INSERT OR IGNORE INTO operation_days
        (id, name, event_date, time_zone, status, emergency_mode, operational_note, version,
         created_at, updated_at, aerodrome, operations_end_at)
       VALUES
        ('${secondEventId}', '${secondEventName}', '2026-07-12', 'Europe/Berlin', 'PREPARATION',
         0, '', 0, '2026-07-12T08:00:00.000Z', '2026-07-12T08:00:00.000Z', 'EDMG',
         '2026-07-12T19:00:00.000Z')`,
    ],
    "Could not add the second synthetic event.",
  );
  run(process.execPath, [npmCli, "run", "build:web"], "Could not build the web application.");
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

async function selectEvent(page, eventId) {
  await page.getByRole("heading", { name: "Veranstaltung auswählen" }).waitFor();
  await page.locator("select").selectOption(eventId);
  await page.getByRole("button", { name: "Veranstaltung öffnen" }).click();
}

await startWorker();
let browser;
try {
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  });
  const login = await context.request.post(`${baseUrl}/api/auth/login`, {
    data: { accountId: adminAccountId, pin },
  });
  if (!login.ok()) throw new Error(`Administrator login returned HTTP ${login.status()}.`);

  const page = await context.newPage();
  await page.goto(`${baseUrl}/admin`, { waitUntil: "domcontentloaded" });
  await selectEvent(page, firstEventId);
  await page.locator("details.account-menu > summary").waitFor();

  await page.goto(`${baseUrl}/admin?event=${firstEventId}&area=events&step=products`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL((url) => !url.searchParams.has("event"));
  await page.locator("details.account-menu > summary").click();
  await page.getByRole("button", { name: /Veranstaltung wechseln/ }).click();
  await page.getByRole("heading", { name: "Veranstaltung auswählen" }).waitFor();

  const selectionUrl = new URL(page.url());
  if (selectionUrl.searchParams.has("event")) {
    throw new Error(`Event parameter survived the switch: ${selectionUrl.href}`);
  }
  if (
    selectionUrl.searchParams.get("area") !== "events" ||
    selectionUrl.searchParams.get("step") !== "products"
  ) {
    throw new Error(`Admin navigation state was not preserved: ${selectionUrl.href}`);
  }

  await selectEvent(page, secondEventId);
  await page.locator(".app-brand strong", { hasText: secondEventName }).waitFor();
  const selectedState = await page.evaluate(() => ({
    eventId: window.localStorage.getItem("active-event-id"),
    eventLabel: window.localStorage.getItem("active-event-label"),
    url: window.location.href,
  }));
  const selectedUrl = new URL(selectedState.url);
  if (selectedState.eventId !== secondEventId || selectedState.eventLabel !== secondEventName) {
    throw new Error(`Second event was not activated: ${JSON.stringify(selectedState)}`);
  }
  if (selectedUrl.searchParams.has("event")) {
    throw new Error(`Event parameter survived second selection: ${selectedUrl.href}`);
  }

  await context.close();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      route: "/admin",
      firstEventId,
      secondEventId,
      eventParameterRemoved: true,
      adminNavigationPreserved: true,
    })}\n`,
  );
} finally {
  await browser?.close();
  stopWorker();
}
