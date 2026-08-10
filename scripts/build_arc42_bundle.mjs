import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Bundles the arc42 chapters into a single Markdown document that pandoc, VS Code
// or any Mermaid aware Markdown renderer can turn into a PDF.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chapterDirectory = resolve(root, "docs/arc42");
const chapterPattern = /^\d{2}-[a-z0-9-]+\.md$/;

function parseArguments(argv) {
  const options = { linkBase: "", out: resolve(root, "output/arc42/rundflug-leitstand-arc42.md") };
  for (const argument of argv) {
    const [key, ...rest] = argument.split("=");
    const value = rest.join("=");
    if (key === "--link-base") options.linkBase = value.replace(/\/+$/, "");
    else if (key === "--out") options.out = resolve(root, value);
    else throw new Error(`Unbekannte Option: ${argument}`);
  }
  return options;
}

export async function chapterFiles() {
  const entries = await readdir(chapterDirectory);
  return entries.filter((name) => chapterPattern.test(name)).sort();
}

export function rewriteRelativeLinks(markdown, documentPath, linkBase) {
  return markdown.replace(/(!?\[[^\]]*]\()([^)]+)(\))/g, (match, prefix, target, suffix) => {
    const trimmed = target.trim();
    if (!trimmed || /^(?:https?:|mailto:|#)/i.test(trimmed)) return match;
    const [path, anchor] = trimmed.split("#", 2);
    if (!path) return match;
    const repositoryPath = relative(root, resolve(dirname(documentPath), path)).replaceAll(
      "\\",
      "/",
    );
    const rewritten = linkBase ? `${linkBase}/${repositoryPath}` : repositoryPath;
    return `${prefix}${anchor ? `${rewritten}#${anchor}` : rewritten}${suffix}`;
  });
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
  if (files.length === 0) throw new Error("Keine arc42-Kapitel unter docs/arc42 gefunden.");
  const sections = [];
  for (const name of files) {
    const documentPath = resolve(chapterDirectory, name);
    const markdown = await readFile(documentPath, "utf8");
    sections.push(rewriteRelativeLinks(markdown.trimEnd(), documentPath, options.linkBase));
  }
  const bundle = `${frontMatter(packageJson.version, buildDate)}\n${sections.join("\n\n")}\n`;
  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, bundle, "utf8");
  return { chapters: files.length, out: options.out, bytes: Buffer.byteLength(bundle, "utf8") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = await buildBundle(options);
  console.log(
    `OK: ${result.chapters} arc42-Kapitel gebündelt (${result.bytes} Bytes) -> ${relative(
      root,
      result.out,
    ).replaceAll("\\", "/")}`,
  );
}
