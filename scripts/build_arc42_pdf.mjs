import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { parseFrontMatter, renderMarkdown } from "./arc42_markdown_to_html.mjs";
import { buildBundle } from "./build_arc42_bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryLinkBase = "https://github.com/aguther/rundflug-leitstand/blob/main";

function parseArguments(argv) {
  const options = {
    out: resolve(root, "output/pdf/rundflug-leitstand-arc42.pdf"),
    html: false,
  };
  for (const argument of argv) {
    const [key, ...rest] = argument.split("=");
    if (key === "--out") options.out = resolve(root, rest.join("="));
    else if (key === "--html") options.html = true;
    else throw new Error(`Unbekannte Option: ${argument}`);
  }
  return options;
}

function documentStyles() {
  return `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 10.2pt; line-height: 1.45; color: #16181d; margin: 0;
    }
    h1 { font-size: 20pt; margin: 0 0 12pt; padding-bottom: 4pt;
      border-bottom: 2px solid #3d5a99; break-after: avoid; }
    h1:not(.title) { break-before: page; }
    h2 { font-size: 14pt; margin: 16pt 0 6pt; color: #1f3564; break-after: avoid; }
    h3 { font-size: 11.5pt; margin: 12pt 0 4pt; color: #1f3564; break-after: avoid; }
    p { margin: 0 0 7pt; text-align: left; orphans: 3; widows: 3; }
    ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
    li { margin-bottom: 3pt; }
    a { color: #1f3564; text-decoration: none; }
    code { font-family: "Cascadia Mono", Consolas, monospace; font-size: 8.8pt;
      background: #f1f2f6; padding: 0 2px; border-radius: 2px; }
    pre.code { background: #f1f2f6; padding: 6pt 8pt; border-radius: 3px;
      font-size: 8.8pt; overflow-wrap: anywhere; white-space: pre-wrap; break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; table-layout: auto;
      font-size: 8.3pt; margin: 0 0 10pt; }
    thead { display: table-header-group; }
    th, td { border: 1px solid #c9ccd6; padding: 3pt 4pt; text-align: left;
      vertical-align: top; overflow-wrap: anywhere; }
    th { background: #eaeef8; color: #1f2f50; }
    tr { break-inside: avoid; }
    figure, .diagram { margin: 10pt 0 12pt; text-align: center; break-inside: avoid; }
    .diagram svg { display: block; width: 100% !important; max-width: 100%;
      max-height: 205mm; height: auto !important; margin: 0 auto; }
    .title-page { display: flex; flex-direction: column; justify-content: center;
      min-height: 235mm; text-align: center; break-after: page; }
    .title-page h1.title { border: none; font-size: 24pt; margin-bottom: 6pt; white-space: nowrap; }
    .title-page .subtitle { font-size: 13pt; color: #40465a; }
    .title-page .meta { margin-top: 18pt; font-size: 10pt; color: #5a6070; }
    nav.toc { break-after: page; }
    nav.toc h1 { break-before: auto; }
    nav.toc ol { padding-left: 18pt; columns: 2; column-gap: 18pt; }
    nav.toc li { break-inside: avoid; margin-bottom: 4pt; }
  `;
}

function tableOfContents(headings) {
  const entries = headings.filter(({ level }) => level === 1);
  const items = entries.map(({ id, text }) => `<li><a href="#${id}">${text}</a></li>`).join("\n");
  return `<nav class="toc"><h1 class="title">Inhalt</h1><ol>${items}</ol></nav>`;
}

function titlePage(metadata) {
  return `
    <section class="title-page">
      <h1 class="title">${metadata.title ?? "Architekturdokumentation"}</h1>
      <div class="subtitle">${metadata.subtitle ?? ""}</div>
      <div class="meta">Stand ${metadata.date ?? ""}<br>
        Erzeugt aus docs/arc42 mit npm run docs:arc42:pdf</div>
    </section>
  `;
}

async function renderMermaid(page, diagrams) {
  const bundlePath = resolve(root, "node_modules/mermaid/dist/mermaid.min.js");
  await access(bundlePath);
  await page.addScriptTag({ path: bundlePath });
  await page.evaluate(async (sources) => {
    globalThis.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      flowchart: { htmlLabels: true, useMaxWidth: true },
      sequence: { useMaxWidth: true },
    });
    for (const [index, source] of sources.entries()) {
      const target = document.querySelector(`[data-diagram-index="${index}"]`);
      if (!target) throw new Error(`Diagram target ${index} missing`);
      const result = await globalThis.mermaid.render(`arc42-diagram-${index}`, source);
      target.innerHTML = result.svg;
      result.bindFunctions?.(target);
    }
  }, diagrams);
}

export async function buildPdf(options) {
  const bundle = await buildBundle({
    linkBase: repositoryLinkBase,
    out: resolve(root, "output/arc42/rundflug-leitstand-arc42.md"),
  });
  const markdown = await readFile(bundle.out, "utf8");
  const { body, metadata } = parseFrontMatter(markdown);
  const diagrams = [];
  const rendered = renderMarkdown(body, {
    renderFence: (language, code, fallback) => {
      if (language !== "mermaid") return fallback;
      const index = diagrams.push(code) - 1;
      return `<figure class="diagram" data-diagram-index="${index}"></figure>`;
    },
  });
  const document = `<!doctype html><html lang="de"><head><meta charset="utf-8">
    <title>${metadata.title ?? "arc42"}</title><style>${documentStyles()}</style></head>
    <body>${titlePage(metadata)}${tableOfContents(rendered.headings)}${rendered.html}</body></html>`;

  await mkdir(dirname(options.out), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.setContent(document, { waitUntil: "load" });
    await renderMermaid(page, diagrams);
    await page.evaluate(() => document.fonts.ready);
    if (options.html) {
      await writeFile(options.out.replace(/\.pdf$/i, ".html"), await page.content(), "utf8");
    }
    await page.pdf({
      path: options.out,
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
      displayHeaderFooter: true,
      headerTemplate:
        '<div style="font-size:7pt;color:#7a808f;width:100%;padding:0 16mm;">Rundflug-Leitstand - Architekturdokumentation (arc42)</div>',
      footerTemplate:
        '<div style="font-size:7pt;color:#7a808f;width:100%;padding:0 16mm;text-align:right;">Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>',
    });
  } finally {
    await browser.close();
  }
  return { out: options.out, diagrams: diagrams.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildPdf(parseArguments(process.argv.slice(2)));
  console.log(
    `OK: arc42-PDF mit ${result.diagrams} Diagrammen erzeugt -> ${relative(root, result.out).replaceAll("\\", "/")}`,
  );
}
