import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontMatter, renderMarkdown } from "./arc42_markdown_to_html.mjs";
import {
  adrFiles,
  chapterFiles,
  renderAdrAppendix,
  rewriteRelativeLinks,
  trimTrailingSlashes,
} from "./build_arc42_bundle.mjs";

describe("arc42 bundle builder", () => {
  it("keeps all chapters in arc42 order", async () => {
    await expect(chapterFiles()).resolves.toEqual([
      "01-einfuehrung-und-ziele.md",
      "02-randbedingungen.md",
      "03-kontextabgrenzung.md",
      "04-loesungsstrategie.md",
      "05-bausteinsicht.md",
      "06-laufzeitsicht.md",
      "07-verteilungssicht.md",
      "08-querschnittliche-konzepte.md",
      "09-architekturentscheidungen.md",
      "10-qualitaetsanforderungen.md",
      "11-risiken-und-technische-schulden.md",
      "12-glossar.md",
    ]);
  });

  it("keeps all ADRs in technical order", async () => {
    const files = await adrFiles();
    expect(files).toHaveLength(52);
    expect(files[0]).toBe("0001-cloudflare-worker-static-assets.md");
    expect(files.at(-1)).toBe("0052-event-archive-delete-reset-lifecycle.md");
  });

  it("rewrites repository links while preserving external links and anchors", () => {
    const source = resolve("docs/architecture/arc42/05-bausteinsicht.md");
    const markdown =
      "[Detail](../technical-debts/README.md) [ADR](../adr/0002-d1-und-durable-object.md) " +
      "[Extern](https://arc42.org/) [Lokal](#ebene)";
    expect(rewriteRelativeLinks(markdown, source, "https://example.test/main")).toBe(
      "[Detail](https://example.test/main/docs/architecture/technical-debts/README.md) " +
        "[ADR](#adr-0002) [Extern](https://arc42.org/) [Lokal](#ebene)",
    );
    expect(rewriteRelativeLinks("[Leer]()", source, "https://example.test/main")).toBe("[Leer]()");
  });

  it("renders ADR source documents as a demoted appendix with internal links", () => {
    const appendix = renderAdrAppendix(
      "# ADR-0001: Synthetic decision\n\n- Status: Akzeptiert\n\n## Kontext\n\n[Next](0002-next.md)\n",
      "0001-synthetic-decision.md",
      "https://example.test/main",
    );
    expect(appendix).toContain("## ADR-0001\n\n**Titel:** Synthetic decision");
    expect(appendix).toContain("### Kontext");
    expect(appendix).toContain("[Next](#adr-0002)");
  });

  it("parses bundle metadata and renders stable heading anchors", () => {
    const parsed = parseFrontMatter('---\ntitle: "Test"\n---\n# Überschrift\n');
    expect(parsed.metadata).toEqual({ title: "Test" });
    const rendered = renderMarkdown(parsed.body);
    expect(rendered.headings).toEqual([{ level: 1, id: "uberschrift", text: "Überschrift" }]);
    expect(rendered.html).toContain('<h1 id="uberschrift">Überschrift</h1>');
  });

  it("processes adversarial malformed links in linear time", () => {
    const malformedLinks = "[x](".repeat(20_000);
    const source = resolve("docs/architecture/arc42/05-bausteinsicht.md");
    const startedAt = performance.now();

    expect(rewriteRelativeLinks(malformedLinks, source, "https://example.test/main")).toBe(
      malformedLinks,
    );
    expect(renderMarkdown(malformedLinks).html).toContain(malformedLinks);

    expect(performance.now() - startedAt).toBeLessThan(150);
  });

  it("parses long malformed front matter, headings, and lists in bounded time", () => {
    const longMarker = "9".repeat(100_000);
    const markdown = `---\n${longMarker}\n---\n${"#".repeat(100_000)} text\n${longMarker}x`;
    const startedAt = performance.now();

    expect(parseFrontMatter(markdown).metadata).toEqual({});
    expect(renderMarkdown(parseFrontMatter(markdown).body).headings).toEqual([]);

    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it("trims only trailing link-base slashes", () => {
    expect(trimTrailingSlashes("https://example.test/path///")).toBe("https://example.test/path");
    expect(trimTrailingSlashes("https://example.test/path")).toBe("https://example.test/path");
    expect(trimTrailingSlashes("///")).toBe("");
  });
});
