import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { WINDOWS_TASKKILL_EXECUTABLE } from "./lib/tool-executables.mjs";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "docs", "roles", "images");
const baseUrl = process.env.ROLE_GUIDE_BASE_URL ?? "http://127.0.0.1:8799";
const managesLocalWorker = !process.env.ROLE_GUIDE_BASE_URL;
const pin = "123456";
const wrangler = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const roleGuidePersistPath = resolve(root, ".wrangler", "role-guide-state");
const roleGuidePersistArgument = ".wrangler/role-guide-state";
let localWorker = null;
let localWorkerOutput = "";
const roles = [
  {
    slug: "kasse",
    accountId: "550e8400-e29b-41d4-a716-446655440201",
    route: "/kasse",
    expected: /Tickets verkaufen|Verkauf/,
    viewport: { width: 1440, height: 900 },
  },
  {
    slug: "flight-line",
    accountId: "550e8400-e29b-41d4-a716-446655440203",
    route: "/flight-line",
    expected: /Flugzeug übernehmen|Verfügbare Flugzeuge/,
    viewport: { width: 1180, height: 820 },
  },
  {
    slug: "flight-director",
    accountId: "550e8400-e29b-41d4-a716-446655440204",
    route: "/flight-director",
    expected: /Flugzeuge . Übersicht|Verkaufte Tickets alle Flugzeuge/,
    viewport: { width: 1440, height: 900 },
  },
  {
    slug: "fids",
    accountId: "550e8400-e29b-41d4-a716-446655440202",
    route: "/fids",
    expected: /Rundflüge|FIDS|Flug/,
    viewport: { width: 1440, height: 900 },
  },
  {
    slug: "administration",
    accountId: "550e8400-e29b-41d4-a716-446655440200",
    route: "/admin",
    expected: /Betriebsstatus|Sicherung & Reset/,
    viewport: { width: 1440, height: 900 },
  },
];

function runNpm(script) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
  const result = spawnSync(process.execPath, [npmCli, "run", script], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`${script} ist fehlgeschlagen.`);
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (localWorker?.exitCode !== null) {
      throw new Error(`Lokaler Worker wurde beendet:\n${localWorkerOutput.slice(-4_000)}`);
    }
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // Der lokale Worker startet noch.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(
    `Lokaler Worker wurde nicht rechtzeitig bereit:\n${localWorkerOutput.slice(-4_000)}`,
  );
}

async function startLocalWorker() {
  await rm(roleGuidePersistPath, { recursive: true, force: true });
  const migration = spawnSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      roleGuidePersistArgument,
      "--config",
      "wrangler.jsonc",
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (migration.status !== 0)
    throw new Error("Isolierte Rollenhandbuch-Datenbank konnte nicht migriert werden.");
  const seed = spawnSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      roleGuidePersistArgument,
      "--config",
      "wrangler.jsonc",
      "--file",
      "apps/worker/seed/demo.sql",
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (seed.status !== 0)
    throw new Error("Isolierte Rollenhandbuch-Datenbank konnte nicht befüllt werden.");
  const fixture = spawnSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      roleGuidePersistArgument,
      "--config",
      "wrangler.jsonc",
      "--file",
      "apps/worker/seed/fids-qa.sql",
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (fixture.status !== 0)
    throw new Error("Synthetische FIDS-Daten konnten nicht geladen werden.");
  runNpm("build:web");
  localWorker = spawn(
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
      roleGuidePersistArgument,
      "--port",
      "8799",
      "--inspector-port",
      "9799",
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  for (const stream of [localWorker.stdout, localWorker.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      localWorkerOutput = `${localWorkerOutput}${chunk}`.slice(-8_000);
    });
  }
  await waitForWorker();
}

function stopLocalWorker() {
  if (!localWorker?.pid) return;
  if (process.platform === "win32") {
    spawnSync(WINDOWS_TASKKILL_EXECUTABLE, ["/pid", String(localWorker.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    localWorker.kill("SIGTERM");
  }
}

await mkdir(outputDirectory, { recursive: true });
if (managesLocalWorker) await startLocalWorker();
let browser;
try {
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  for (const role of roles) {
    const context = await browser.newContext({
      viewport: role.viewport,
      colorScheme: "light",
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
    });
    const errors = [];
    const failedResources = [];
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failedResources.push(`${response.status()} ${response.url()}`);
      }
    });
    const login = await context.request.post(`${baseUrl}/api/auth/login`, {
      data: { accountId: role.accountId, pin },
    });
    if (!login.ok()) {
      throw new Error(`${role.slug}: Anmeldung lieferte HTTP ${login.status()}.`);
    }
    await page.goto(`${baseUrl}${role.route}`, { waitUntil: "networkidle" });
    const openEvent = page.getByRole("button", { name: "Veranstaltung öffnen" });
    if (await openEvent.isVisible()) {
      await page.locator("select").selectOption("demo-2026");
      await openEvent.click();
      await page.waitForTimeout(750);
    }
    try {
      await page.getByText(role.expected).first().waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      const visibleText = (await page.locator("body").innerText()).slice(0, 800);
      throw new Error(
        `${role.slug}: Erwartete Rollenansicht fehlt unter ${page.url()}. Sichtbarer Text: ${visibleText}`,
      );
    }
    if (role.slug === "flight-line") {
      const claimAircraft = page.getByRole("button", { name: "Übernehmen", exact: true }).first();
      if (await claimAircraft.isVisible()) {
        await claimAircraft.click();
        await page.waitForTimeout(750);
      }
    }
    const unexpectedResources = failedResources.filter(
      (entry) =>
        !/^404 .*\/api\/public\/events\/[^/]+\/logo\?theme=/.test(entry) &&
        !/^503 .*\/api\/public\/push\/config$/.test(entry),
    );
    const unexpectedConsoleErrors = errors.filter(
      (entry) => !entry.startsWith("Failed to load resource:"),
    );
    if (unexpectedResources.length > 0 || unexpectedConsoleErrors.length > 0) {
      throw new Error(
        `${role.slug}: Browser-Konsole enthält Fehler: ${unexpectedConsoleErrors.join(" | ")}; Ressourcen: ${unexpectedResources.join(" | ")}`,
      );
    }
    await page.screenshot({
      path: resolve(outputDirectory, `${role.slug}-1.11.0.png`),
      fullPage: false,
    });
    process.stdout.write(
      `${JSON.stringify({ role: role.slug, url: page.url(), title: await page.title(), consoleErrors: 0 })}\n`,
    );
    await context.close();
  }
} finally {
  await browser?.close();
  if (managesLocalWorker) stopLocalWorker();
}
