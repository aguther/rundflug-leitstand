import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replaceMarkdownLinks } from "./lib/markdown-links.mjs";
import { compareTechnicalStrings } from "./lib/technical-order.mjs";

// Bundles the arc42 chapters into a single Markdown document that pandoc, VS Code
// or any Mermaid aware Markdown renderer can turn into a PDF.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chapterDirectory = resolve(root, "docs/architecture/arc42");
const adrDirectory = resolve(root, "docs/architecture/adr");
const chapterPattern = /^\d{2}-[a-z0-9-]+\.md$/;
const adrPattern = /^\d{4}-[a-z0-9-]+\.md$/;

function parseArguments(argv) {
  const options = { linkBase: "", out: resolve(root, "output/arc42/rundflug-leitstand-arc42.md") };
  for (const argument of argv) {
    const [key, ...rest] = argument.split("=");
    const value = rest.join("=");
    if (key === "--link-base") options.linkBase = trimTrailingSlashes(value);
    else if (key === "--out") options.out = resolve(root, value);
    else throw new Error(`Unbekannte Option: ${argument}`);
  }
  return options;
}

export function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export async function chapterFiles() {
  const entries = await readdir(chapterDirectory);
  return entries.filter((name) => chapterPattern.test(name)).sort(compareTechnicalStrings);
}

export async function adrFiles() {
  const entries = await readdir(adrDirectory);
  return entries.filter((name) => adrPattern.test(name)).sort(compareTechnicalStrings);
}

function adrAnchor(name) {
  return `adr-${name.slice(0, 4)}`;
}

export function rewriteRelativeLinks(markdown, documentPath, linkBase) {
  return replaceMarkdownLinks(markdown, (match) => {
    const trimmed = match.target.trim();
    if (!trimmed || /^(?:https?:|mailto:|#)/i.test(trimmed)) return match.raw;
    const [path, anchor] = trimmed.split("#", 2);
    if (!path) return match.raw;
    const resolvedTarget = resolve(dirname(documentPath), path);
    const repositoryPath = relative(root, resolvedTarget).replaceAll("\\", "/");
    if (
      dirname(resolvedTarget) === adrDirectory &&
      adrPattern.test(resolvedTarget.split(/[\\/]/).at(-1))
    ) {
      const target = `#${adrAnchor(resolvedTarget.split(/[\\/]/).at(-1))}`;
      const prefix = `${match.image ? "!" : ""}[${match.label}](`;
      return `${prefix}${target})`;
    }
    const rewritten = linkBase ? `${linkBase}/${repositoryPath}` : repositoryPath;
    const prefix = `${match.image ? "!" : ""}[${match.label}](`;
    const target = anchor ? `${rewritten}#${anchor}` : rewritten;
    return `${prefix}${target})`;
  });
}

export function renderAdrAppendix(markdown, name, linkBase) {
  const lines = markdown.trimEnd().split(/\r?\n/);
  const sourceHeading = lines.shift() ?? "";
  const expectedPrefix = `# ADR-${name.slice(0, 4)}:`;
  if (!sourceHeading.startsWith(expectedPrefix)) {
    throw new Error(`ADR ${name} beginnt nicht mit "${expectedPrefix}".`);
  }
  const title = sourceHeading.slice(expectedPrefix.length).trim();
  const demoted = lines.map((line) => (line.startsWith("#") ? `#${line}` : line)).join("\n");
  const documentPath = resolve(adrDirectory, name);
  const body = rewriteRelativeLinks(demoted, documentPath, linkBase);
  return `## ADR-${name.slice(0, 4)}\n\n**Titel:** ${title}\n${body}`;
}

function frontMatter(version, buildDate) {
  return [
    "---",
    'title: "Architekturdokumentation Rundflug-Leitstand"',
    `subtitle: "arc42 – Anwendungs- und Anforderungsstand ${version}"`,
    `date: "${buildDate}"`,
    "lang: de",
    "toc: true",
    "toc-depth: 3",
    "papersize: a4",
    "geometry: margin=25mm",
    "colorlinks: true",
    "---",
    "",
  ].join("\n");
}

export async function buildBundle(options) {
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const buildDate = new Date().toISOString().slice(0, 10);
  const files = await chapterFiles();
  const adrs = await adrFiles();
  if (files.length === 0) {
    throw new Error("Keine arc42-Kapitel unter docs/architecture/arc42 gefunden.");
  }
  if (adrs.length === 0) {
    throw new Error("Keine ADRs unter docs/architecture/adr gefunden.");
  }
  const sections = [];
  for (const name of files) {
    const documentPath = resolve(chapterDirectory, name);
    const markdown = await readFile(documentPath, "utf8");
    sections.push(rewriteRelativeLinks(markdown.trimEnd(), documentPath, options.linkBase));
  }
  const appendix = [];
  for (const name of adrs) {
    const markdown = await readFile(resolve(adrDirectory, name), "utf8");
    appendix.push(renderAdrAppendix(markdown, name, options.linkBase));
  }
  sections.push(
    `# Anhang A – Architecture Decision Records\n\nDieser Anhang wird direkt aus \`docs/architecture/adr/\` erzeugt. Maßgeblich bleiben die einzelnen Quelldateien.\n\n${appendix.join("\n\n")}`,
  );
  const bundle = `${frontMatter(packageJson.version, buildDate)}\n${sections.join("\n\n")}\n`;
  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, bundle, "utf8");
  return {
    chapters: files.length,
    adrs: adrs.length,
    out: options.out,
    bytes: Buffer.byteLength(bundle, "utf8"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = await buildBundle(options);
  console.log(
    `OK: ${result.chapters} arc42-Kapitel und ${result.adrs} ADRs gebündelt (${result.bytes} Bytes) -> ${relative(
      root,
      result.out,
    ).replaceAll("\\", "/")}`,
  );
}
