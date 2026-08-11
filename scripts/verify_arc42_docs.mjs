import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { compareTechnicalStrings } from "./lib/technical-order.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const expectedArc42Chapters = [
  ["01-einfuehrung-und-ziele.md", "# 1. Einführung und Ziele"],
  ["02-randbedingungen.md", "# 2. Randbedingungen"],
  ["03-kontextabgrenzung.md", "# 3. Kontextabgrenzung"],
  ["04-loesungsstrategie.md", "# 4. Lösungsstrategie"],
  ["05-bausteinsicht.md", "# 5. Bausteinsicht"],
  ["06-laufzeitsicht.md", "# 6. Laufzeitsicht"],
  ["07-verteilungssicht.md", "# 7. Verteilungssicht"],
  ["08-querschnittliche-konzepte.md", "# 8. Querschnittliche Konzepte"],
  ["09-architekturentscheidungen.md", "# 9. Architekturentscheidungen"],
  ["10-qualitaetsanforderungen.md", "# 10. Qualitätsanforderungen"],
  ["11-risiken-und-technische-schulden.md", "# 11. Risiken und technische Schulden"],
  ["12-glossar.md", "# 12. Glossar"],
];

let mermaidParser;

async function parseMermaid(source) {
  if (!mermaidParser) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    mermaidParser = (await import("mermaid")).default;
    mermaidParser.initialize({ startOnLoad: false, securityLevel: "strict" });
  }
  await mermaidParser.parse(source);
}

function markdownTargets(markdown) {
  return [...markdown.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ""))
    .filter((target) => target && !/^(?:https?:|mailto:|#)/i.test(target));
}

async function validateLocalLinks(document, markdown, failures) {
  for (const target of markdownTargets(markdown)) {
    const pathPart = target.split("#", 1)[0];
    if (!pathPart) continue;
    const targetPath = resolve(dirname(document), decodeURIComponent(pathPart));
    try {
      await access(targetPath);
    } catch {
      failures.push(`Lokaler Link fehlt: ${document.replaceAll("\\", "/")} -> ${target}`);
    }
  }
}

export async function verifyArc42Documentation(root = defaultRoot) {
  const chapterDirectory = resolve(root, "docs/arc42");
  const adrDirectory = resolve(root, "docs/adr");
  const failures = [];
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const expectedNames = new Set(expectedArc42Chapters.map(([name]) => name));
  const presentFiles = (await readdir(chapterDirectory)).filter(
    (name) => extname(name) === ".md" && name !== "README.md",
  );
  for (const name of presentFiles) {
    if (!expectedNames.has(name)) {
      failures.push(`Unerwartetes Kapitel ohne Gliederungsplatz: ${name}`);
    }
  }

  const indexPath = resolve(chapterDirectory, "README.md");
  const index = await readFile(indexPath, "utf8");
  const documents = [[indexPath, index]];
  let mermaidDiagrams = 0;

  for (const [name, heading] of expectedArc42Chapters) {
    const documentPath = resolve(chapterDirectory, name);
    let markdown;
    try {
      markdown = await readFile(documentPath, "utf8");
    } catch {
      failures.push(`Kapitel fehlt: ${name}`);
      continue;
    }
    documents.push([documentPath, markdown]);
    if (!markdown.startsWith(`${heading}\n`)) {
      failures.push(`Kapitel ${name} beginnt nicht mit "${heading}".`);
    }
    if (!index.includes(`(${name})`)) {
      failures.push(`Kapitel ${name} ist nicht im Inhaltsverzeichnis verlinkt.`);
    }
    const fences = markdown.match(/^```/gm) ?? [];
    if (fences.length % 2 !== 0) {
      failures.push(`Kapitel ${name} enthält einen offenen Codeblock.`);
    }
    for (const block of markdown.matchAll(/^```mermaid\r?\n([\s\S]*?)^```$/gm)) {
      mermaidDiagrams += 1;
      const source = block[1].trim();
      if (!source) {
        failures.push(`Kapitel ${name} enthält ein leeres Mermaid-Diagramm.`);
        continue;
      }
      try {
        await parseMermaid(source);
      } catch (error) {
        const message = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
        failures.push(`Ungültiges Mermaid-Diagramm in ${name}: ${message}`);
      }
    }
  }

  if (mermaidDiagrams < 8) {
    failures.push(`Zu wenige Mermaid-Diagramme: ${mermaidDiagrams}; erwartet sind mindestens 8.`);
  }

  const versionMarker = `**${packageJson.version}**`;
  if (!index.includes(versionMarker)) {
    failures.push(`arc42-Index nennt nicht die aktuelle Projektversion ${packageJson.version}.`);
  }
  const introduction = documents.find(([path]) =>
    path.endsWith("01-einfuehrung-und-ziele.md"),
  )?.[1];
  if (!introduction?.includes(versionMarker)) {
    failures.push(`Kapitel 1 nennt nicht die aktuelle Projektversion ${packageJson.version}.`);
  }

  const adrFiles = (await readdir(adrDirectory))
    .filter((name) => /^\d{4}-.*\.md$/.test(name))
    .sort(compareTechnicalStrings);
  const decisionChapter =
    documents.find(([path]) => path.endsWith("09-architekturentscheidungen.md"))?.[1] ?? "";
  for (const adrFile of adrFiles) {
    const link = `(../adr/${adrFile})`;
    const occurrences = decisionChapter.split(link).length - 1;
    if (occurrences !== 1) {
      failures.push(
        `ADR ${adrFile} muss in Kapitel 9 genau einmal verlinkt sein; gefunden: ${occurrences}.`,
      );
    }
  }

  for (const [document, markdown] of documents) {
    await validateLocalLinks(document, markdown, failures);
  }

  for (const forbidden of ["Flight Line Assist", "Flight Line Supervisor"]) {
    const affected = documents
      .filter(([, markdown]) => markdown.includes(forbidden))
      .map(([path]) => path.replaceAll("\\", "/"));
    if (affected.length > 0) {
      failures.push(`Veralteter Begriff "${forbidden}" in: ${affected.join(", ")}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`arc42-Dokumentation inkonsistent:\n- ${failures.join("\n- ")}`);
  }
  return {
    chapters: expectedArc42Chapters.length,
    diagrams: mermaidDiagrams,
    adrs: adrFiles.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await verifyArc42Documentation();
  console.log(
    `OK: arc42-Dokumentation konsistent (${result.chapters} Kapitel, ${result.diagrams} Diagramme, ${result.adrs} ADRs)`,
  );
}
