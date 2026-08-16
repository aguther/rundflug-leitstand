import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectedArc42Chapters, verifyArc42Documentation } from "./verify_arc42_docs.mjs";

let root: string;

async function write(path: string, content: string) {
  const target = resolve(root, path);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function replace(path: string, current: string, replacement: string) {
  const target = resolve(root, path);
  const content = await readFile(target, "utf8");
  await writeFile(target, content.replace(current, replacement), "utf8");
}

async function createValidFixture() {
  await write("package.json", JSON.stringify({ version: "1.2.3" }));
  await write(
    "docs/architecture/adr/0001-test.md",
    "# ADR-0001: Test decision\n\n- Status: Akzeptiert\n",
  );
  const links = expectedArc42Chapters
    .map(([name, heading]) => `- [${heading.slice(2)}](${name})`)
    .join("\n");
  await write(
    "docs/architecture/arc42/README.md",
    `# Architekturdokumentation\n\nStand **1.2.3**\n\n${links}\n`,
  );
  for (const [name, heading] of expectedArc42Chapters) {
    const version = name.startsWith("01-") ? "\n\nStand **1.2.3**" : "";
    const diagram =
      Number(name.slice(0, 2)) <= 8 ? "\n\n```mermaid\nflowchart LR\n    A --> B\n```" : "";
    const adr = name.startsWith("09-") ? "\n\n[0001](../adr/0001-test.md)" : "";
    await write(`docs/architecture/arc42/${name}`, `${heading}${version}${diagram}${adr}\n`);
  }
}

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "arc42-verifier-"));
  await createValidFixture();
}, 30_000);

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
}, 30_000);

describe("arc42 documentation verifier", () => {
  it("accepts a complete and consistent document set", async () => {
    await expect(verifyArc42Documentation(root)).resolves.toMatchObject({
      chapters: 12,
      diagrams: 8,
      adrs: 1,
    });
  });

  it("accepts an ADR status section with Windows line endings", async () => {
    await write(
      "docs/architecture/adr/0001-test.md",
      "# ADR-0001: Test decision\r\n\r\n## Status\r\n\r\nFreigegeben, Release 1.2.3.\r\n",
    );

    await expect(verifyArc42Documentation(root)).resolves.toMatchObject({ adrs: 1 });
  });

  it("rejects an unknown successor in a replacement status", async () => {
    await write(
      "docs/architecture/adr/0001-test.md",
      "# ADR-0001: Test decision\n\n- Status: Ersetzt durch ADR-9999\n",
    );

    await expect(verifyArc42Documentation(root)).rejects.toThrow(
      "verweist auf unbekannten Nachfolger ADR-9999",
    );
  });

  it("rejects a missing chapter", async () => {
    await rm(resolve(root, "docs/architecture/arc42/06-laufzeitsicht.md"));
    await expect(verifyArc42Documentation(root)).rejects.toThrow("Kapitel fehlt");
  });

  it("rejects an ADR missing from the decision chapter", async () => {
    await write(
      "docs/architecture/adr/0002-unlinked.md",
      "# ADR-0002: Unlinked decision\n\n- Status: Akzeptiert\n",
    );
    await expect(verifyArc42Documentation(root)).rejects.toThrow(
      "0002-unlinked.md muss in Kapitel 9 genau einmal verlinkt sein",
    );
  });

  it("rejects stale project version references", async () => {
    await replace("docs/architecture/arc42/README.md", "**1.2.3**", "**1.2.2**");
    await replace("docs/architecture/arc42/01-einfuehrung-und-ziele.md", "**1.2.3**", "**1.2.2**");
    await expect(verifyArc42Documentation(root)).rejects.toThrow("aktuelle Projektversion 1.2.3");
  });

  it("rejects a broken local link", async () => {
    await write(
      "docs/architecture/arc42/12-glossar.md",
      "# 12. Glossar\n\n[Fehlend](../architecture/fehlt.md)\n",
    );
    await expect(verifyArc42Documentation(root)).rejects.toThrow("Lokaler Link fehlt");
  });

  it("rejects an open code fence", async () => {
    await write(
      "docs/architecture/arc42/02-randbedingungen.md",
      "# 2. Randbedingungen\n\n```text\noffen\n",
    );
    await expect(verifyArc42Documentation(root)).rejects.toThrow("offenen Codeblock");
  });

  it("rejects invalid Mermaid syntax", async () => {
    await replace(
      "docs/architecture/arc42/01-einfuehrung-und-ziele.md",
      "flowchart LR\n    A --> B",
      "flowchart LR\n    A --",
    );
    await expect(verifyArc42Documentation(root)).rejects.toThrow("Ungültiges Mermaid-Diagramm");
  });
});
