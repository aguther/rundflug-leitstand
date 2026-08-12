import { replaceMarkdownLinks } from "./lib/markdown-links.mjs";

const codeOpen = String.fromCodePoint(0);
const codeClose = String.fromCodePoint(1);

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function renderInline(text) {
  const codeSpans = [];
  const withoutCode = text.replace(/`([^`]+)`/g, (_match, code) => {
    codeSpans.push(code);
    return `${codeOpen}${codeSpans.length - 1}${codeClose}`;
  });
  const linkedHtml = replaceMarkdownLinks(escapeHtml(withoutCode), (match) => {
    if (match.image) return `<img alt="${match.label}" src="${match.target}">`;
    if (match.label.length === 0) return match.raw;
    return `<a href="${match.target}">${match.label}</a>`;
  });
  const html = linkedHtml
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return html.replace(
    new RegExp(`${codeOpen}(\\d+)${codeClose}`, "g"),
    (_match, index) => `<code>${escapeHtml(codeSpans[Number(index)])}</code>`,
  );
}

export function parseFrontMatter(markdown) {
  if (!markdown.startsWith("---\n")) return { body: markdown, metadata: {} };
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) return { body: markdown, metadata: {} };
  const metadata = {};
  for (const line of markdown.slice(4, end).split("\n")) {
    const match = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (match) metadata[match[1]] = match[2].trim().replace(/^"|"$/g, "");
  }
  return { body: markdown.slice(end + 5), metadata };
}

function tableCells(row) {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(rows) {
  const head = tableCells(rows[0])
    .map((cell) => `<th>${renderInline(cell)}</th>`)
    .join("");
  const body = rows
    .slice(2)
    .map(tableCells)
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

function renderList(items, ordered) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>\n${items.map((item) => `<li>${renderInline(item)}</li>`).join("\n")}\n</${tag}>`;
}

function isTableRow(line) {
  return line.trimStart().startsWith("|");
}

function isListItem(line) {
  return /^\s*(?:[-*]|\d+\.)\s+/.test(line);
}

export function renderMarkdown(markdown, { renderFence } = {}) {
  const lines = markdown.split("\n");
  const html = [];
  const headings = [];
  const usedHeadingIds = new Map();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const baseId = slugify(heading[2]) || `section-${headings.length + 1}`;
      const count = usedHeadingIds.get(baseId) ?? 0;
      usedHeadingIds.set(baseId, count + 1);
      const id = count === 0 ? baseId : `${baseId}-${count + 1}`;
      html.push(`<h${level} id="${id}">${renderInline(heading[2])}</h${level}>`);
      headings.push({ level, id, text: heading[2] });
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const content = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        content.push(lines[index]);
        index += 1;
      }
      index += 1;
      const code = content.join("\n");
      const fallback = `<pre class="code"><code>${escapeHtml(code)}</code></pre>`;
      html.push(renderFence ? renderFence(language, code, fallback) : fallback);
      continue;
    }
    if (isTableRow(line)) {
      const rows = [];
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(lines[index]);
        index += 1;
      }
      html.push(renderTable(rows));
      continue;
    }
    if (isListItem(line)) {
      const ordered = !/^\s*[-*]\s/.test(line);
      const items = [];
      while (index < lines.length) {
        const current = lines[index];
        const entry = current.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
        if (entry) {
          items.push(entry[1]);
          index += 1;
          continue;
        }
        if (/^\s+\S/.test(current) && items.length > 0) {
          items[items.length - 1] += ` ${current.trim()}`;
          index += 1;
          continue;
        }
        break;
      }
      html.push(renderList(items, ordered));
      continue;
    }
    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim().length > 0 &&
      !lines[index].startsWith("```") &&
      !isTableRow(lines[index]) &&
      !/^#{1,6}\s/.test(lines[index]) &&
      !isListItem(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    const text = paragraph.join(" ");
    const isImageOnly = /^!\[[^\]]*]\([^)]+\)$/.test(text);
    html.push(
      isImageOnly ? `<figure>${renderInline(text)}</figure>` : `<p>${renderInline(text)}</p>`,
    );
  }
  return { html: html.join("\n"), headings };
}
