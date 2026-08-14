const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const canonicalDiagrams = [
  {
    id: "technical-context",
    file: "docs/arc42/03-kontextabgrenzung.md",
    heading: "## 3.2 Technischer Kontext",
  },
  {
    id: "workspace-overview",
    file: "docs/arc42/05-bausteinsicht.md",
    heading: "## 5.1 Ebene 1 – Gesamtsystem",
  },
  {
    id: "web-component-flow",
    file: "docs/arc42/05-bausteinsicht.md",
    heading: "### Web-interne Bausteingrenzen",
  },
  {
    id: "sell-ticket-sequence",
    file: "docs/arc42/06-laufzeitsicht.md",
    heading: "## 6.1 Schreibkommando: Verkauf an der Kasse",
  },
];

function extractMermaidSource(markdown, heading, file) {
  const headingOffset = markdown.indexOf(heading);
  if (headingOffset < 0) throw new Error(`Heading not found in ${file}: ${heading}`);

  const blockOffset = markdown.indexOf("```mermaid", headingOffset + heading.length);
  if (blockOffset < 0) throw new Error(`Mermaid block not found after ${heading} in ${file}`);

  const sourceOffset = blockOffset + "```mermaid".length;
  const blockEnd = markdown.indexOf("\n```", sourceOffset);
  if (blockEnd < 0) throw new Error(`Unclosed Mermaid block after ${heading} in ${file}`);

  return markdown.slice(sourceOffset, blockEnd).trim();
}

async function renderCanonicalDiagrams(page, repositoryRoot) {
  const definitions = canonicalDiagrams.map((diagram) => {
    const absolutePath = path.join(repositoryRoot, diagram.file);
    const markdown = fs.readFileSync(absolutePath, "utf8");
    return {
      id: diagram.id,
      source: extractMermaidSource(markdown, diagram.heading, diagram.file),
    };
  });

  const mermaidBundle = path.join(path.dirname(require.resolve("mermaid")), "mermaid.min.js");
  await page.addScriptTag({
    path: mermaidBundle,
  });
  await page.evaluate(async (diagrams) => {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      flowchart: { htmlLabels: true, useMaxWidth: false },
      sequence: { useMaxWidth: false },
    });

    for (const diagram of diagrams) {
      const host = document.querySelector(`[data-mermaid-diagram="${diagram.id}"]`);
      if (!host) throw new Error(`Presentation placeholder missing: ${diagram.id}`);
      const { svg } = await window.mermaid.render(`arc42-${diagram.id}`, diagram.source);
      host.innerHTML = svg;
    }
  }, definitions);
}

async function main() {
  const deckDirectory = __dirname;
  const repositoryRoot = path.resolve(deckDirectory, "../../..");
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
  reportStatus("Rendering canonical arc42 Mermaid diagrams…");
  await renderCanonicalDiagrams(page, repositoryRoot);
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
  if (slideCount !== 40) throw new Error(`Expected 40 slides, found ${slideCount}`);

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
