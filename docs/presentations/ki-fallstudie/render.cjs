const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function main() {
  const deckDirectory = __dirname;
  const outputPath = path.resolve(
    process.argv[2] || path.join(deckDirectory, "rundflug-leitstand-ki-fallstudie.pdf"),
  );
  const previewDirectory = process.env.PREVIEW_DIR ? path.resolve(process.env.PREVIEW_DIR) : null;
  const statusPath =
    process.env.RENDER_STATUS_PATH ||
    path.join(os.tmpdir(), "rundflug-ki-fallstudie-render-status.txt");
  const reportStatus = (message) => {
    console.log(message);
    fs.writeFileSync(statusPath, `${message}\n`, "utf8");
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (previewDirectory) fs.mkdirSync(previewDirectory, { recursive: true });

  reportStatus("Launching browser…");
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });

  reportStatus("Loading presentation source…");
  await page.goto(pathToFileURL(path.join(deckDirectory, "index.html")).href, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  reportStatus("Waiting for fonts and images…");
  await page.evaluate(async () => {
    await Promise.race([
      document.fonts.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Font loading timed out")), 15_000),
      ),
    ]);
    await Promise.all(
      Array.from(document.images, (image) => {
        if (image.complete) {
          if (image.naturalWidth > 0) return Promise.resolve();
          return Promise.reject(new Error(`Image failed: ${image.src}`));
        }
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(`Image loading timed out: ${image.src}`)),
            30_000,
          );
          const finish = (callback) => {
            clearTimeout(timeout);
            callback();
          };
          image.addEventListener("load", () => finish(resolve), { once: true });
          image.addEventListener(
            "error",
            () => finish(() => reject(new Error(`Image failed: ${image.src}`))),
            { once: true },
          );
        });
      }),
    );
  });

  const slides = page.locator(".slide");
  const slideCount = await slides.count();
  if (slideCount !== 41) throw new Error(`Expected 41 slides, found ${slideCount}`);

  if (previewDirectory) {
    for (let index = 0; index < slideCount; index += 1) {
      await slides.nth(index).screenshot({
        path: path.join(previewDirectory, `slide-${String(index + 1).padStart(2, "0")}.png`),
        animations: "disabled",
      });
    }
  }

  reportStatus("Writing PDF…");
  await page.pdf({
    path: outputPath,
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
    outline: false,
  });

  reportStatus("PDF written successfully.");
  console.log(JSON.stringify({ outputPath, slideCount, previewDirectory, statusPath }, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
