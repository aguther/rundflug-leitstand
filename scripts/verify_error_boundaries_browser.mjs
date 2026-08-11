import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { WINDOWS_TASKKILL_EXECUTABLE } from "./lib/tool-executables.mjs";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.ERROR_BOUNDARY_BROWSER_PORT ?? "18804");
const baseUrl = `http://127.0.0.1:${port}`;
const vite = resolve(root, "node_modules", "vite", "bin", "vite.js");
const config = resolve(root, "apps", "web", "vite.error-boundary.config.ts");
const sensitiveErrorDetail = "synthetic-ticket-token-ABCD1234";
let serverOutput = "";

const server = spawn(
  process.execPath,
  [vite, "--config", config, "--host", "127.0.0.1", "--port", String(port)],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-8_000);
  });
}

function stopServer() {
  if (!server.pid) return;
  if (process.platform === "win32") {
    spawnSync(WINDOWS_TASKKILL_EXECUTABLE, ["/pid", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    server.kill("SIGTERM");
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Error-boundary browser server exited early:\n${serverOutput}`);
    }
    try {
      if ((await fetch(`${baseUrl}/error-boundary-browser.html`)).ok) return;
    } catch {
      // The isolated Vite server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Error-boundary browser server did not become ready:\n${serverOutput}`);
}

const cases = [
  { scope: "application", theme: "light", width: 1366, height: 768 },
  { scope: "route", theme: "dark", width: 1366, height: 768 },
  { scope: "application", theme: "dark", width: 430, height: 932 },
  { scope: "route", theme: "light", width: 430, height: 932 },
];

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const results = [];
  for (const testCase of cases) {
    const context = await browser.newContext({
      viewport: { width: testCase.width, height: testCase.height },
      colorScheme: testCase.theme,
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/error-boundary-browser.html?${new URLSearchParams(testCase)}`, {
      waitUntil: "networkidle",
    });

    const expectedHeading =
      testCase.scope === "application"
        ? "Anwendung konnte nicht angezeigt werden."
        : "Arbeitsbereich konnte nicht angezeigt werden.";
    const alert = page.getByRole("alert");
    await alert.waitFor({ state: "visible" });
    if ((await alert.textContent())?.includes(sensitiveErrorDetail)) {
      throw new Error("The error fallback exposed the synthetic sensitive detail.");
    }
    if (!(await page.getByRole("heading", { name: expectedHeading }).isVisible())) {
      throw new Error(`The ${testCase.scope} fallback heading is missing.`);
    }
    const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim());
    if (focusedText !== expectedHeading) {
      throw new Error(`The ${testCase.scope} fallback heading did not receive focus.`);
    }
    const reloadButton = page.getByRole("button", { name: "Neu laden" });
    const buttonBox = await reloadButton.boundingBox();
    if (!buttonBox || buttonBox.height < 44) {
      throw new Error(`The reload button is below the 44px touch target.`);
    }
    const horizontallyClipped = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (horizontallyClipped) throw new Error("The fallback creates horizontal overflow.");
    if (await page.locator("vite-error-overlay").isVisible()) {
      throw new Error("The Vite error overlay obscures the handled fallback.");
    }

    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), reloadButton.click()]);
    await page.getByRole("heading", { name: "Arbeitsbereich wiederhergestellt" }).waitFor({
      state: "visible",
    });
    if (await page.getByRole("alert").isVisible()) {
      throw new Error(`The ${testCase.scope} fallback remained visible after recovery.`);
    }

    results.push(testCase);
    await context.close();
  }
  console.log(JSON.stringify({ ok: true, cases: results }));
} finally {
  await browser?.close();
  stopServer();
}
