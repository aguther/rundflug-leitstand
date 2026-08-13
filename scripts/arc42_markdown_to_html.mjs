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
    new RegExp(String.raw`${codeOpen}(\d+)${codeClose}`, "g"),
    (_match, index) => `<code>${escapeHtml(codeSpans[Number(index)])}</code>`,
  );
}

function isFrontMatterKeyCharacter(character) {
  const codePoint = character.codePointAt(0);
  return (
    character === "-" ||
    (codePoint >= 65 && codePoint <= 90) ||
    (codePoint >= 97 && codePoint <= 122)
  );
}

function frontMatterEntry(line) {
  const separator = line.indexOf(":");
  if (separator <= 0) return null;
  const key = line.slice(0, separator);
  if (![...key].every(isFrontMatterKeyCharacter)) return null;
  let value = line.slice(separator + 1).trim();
  if (value.startsWith('"')) value = value.slice(1);
  if (value.endsWith('"')) value = value.slice(0, -1);
  return { key, value };
}

function isWhitespace(character) {
  return character !== undefined && character.trim().length === 0;
}

function parseHeading(line) {
  let level = 0;
  while (level < 6 && line[level] === "#") level += 1;
  if (level === 0 || !isWhitespace(line[level])) return null;
  let textStart = level;
  while (isWhitespace(line[textStart])) textStart += 1;
  return { level, text: line.slice(textStart) };
}

function parseListItem(line) {
  const content = line.trimStart();
  let markerEnd = 0;
  let ordered = false;
  if (content[0] === "-" || content[0] === "*") {
    markerEnd = 1;
  } else {
    while (content[markerEnd] >= "0" && content[markerEnd] <= "9") markerEnd += 1;
    if (markerEnd === 0 || content[markerEnd] !== ".") return null;
    markerEnd += 1;
    ordered = true;
  }
  if (!isWhitespace(content[markerEnd])) return null;
  let textStart = markerEnd;
  while (isWhitespace(content[textStart])) textStart += 1;
  return { ordered, text: content.slice(textStart) };
}

export function parseFrontMatter(markdown) {
  if (!markdown.startsWith("---\n")) return { body: markdown, metadata: {} };
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) return { body: markdown, metadata: {} };
  const metadata = {};
  for (const line of markdown.slice(4, end).split("\n")) {
    const entry = frontMatterEntry(line);
    if (entry) metadata[entry.key] = entry.value;
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
    .map((row) => {
      const cells = row.map((cell) => `<td>${renderInline(cell)}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
  return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

function renderList(items, ordered) {
  const tag = ordered ? "ol" : "ul";
  const entries = items.map((item) => `<li>${renderInline(item)}</li>`).join("\n");
  return `<${tag}>\n${entries}\n</${tag}>`;
}

function isTableRow(line) {
  return line.trimStart().startsWith("|");
}

function isListItem(line) {
  return parseListItem(line) !== null;
}

function renderHeading(line, headings, usedHeadingIds) {
  const heading = parseHeading(line);
  if (!heading) return null;
  const { level, text } = heading;
  const baseId = slugify(text) || `section-${headings.length + 1}`;
  const count = usedHeadingIds.get(baseId) ?? 0;
  usedHeadingIds.set(baseId, count + 1);
  const id = count === 0 ? baseId : `${baseId}-${count + 1}`;
  headings.push({ level, id, text });
  return `<h${level} id="${id}">${renderInline(text)}</h${level}>`;
}

function consumeFence(lines, startIndex, renderFence) {
  if (!lines[startIndex].startsWith("```")) return null;
  const language = lines[startIndex].slice(3).trim();
  const content = [];
  let index = startIndex + 1;
  while (index < lines.length && !lines[index].startsWith("```")) {
    content.push(lines[index]);
    index += 1;
  }
  const code = content.join("\n");
  const fallback = `<pre class="code"><code>${escapeHtml(code)}</code></pre>`;
  return {
    html: renderFence ? renderFence(language, code, fallback) : fallback,
    nextIndex: index + 1,
  };
}

function consumeTable(lines, startIndex) {
  if (!isTableRow(lines[startIndex])) return null;
  const rows = [];
  let index = startIndex;
  while (index < lines.length && isTableRow(lines[index])) {
    rows.push(lines[index]);
    index += 1;
  }
  return { html: renderTable(rows), nextIndex: index };
}

function consumeList(lines, startIndex) {
  const firstEntry = parseListItem(lines[startIndex]);
  if (!firstEntry) return null;
  const items = [];
  let index = startIndex;
  while (index < lines.length) {
    const current = lines[index];
    const entry = parseListItem(current);
    if (entry) {
      items.push(entry.text);
      index += 1;
      continue;
    }
    if (!/^\s+\S/.test(current) || items.length === 0) break;
    items[items.length - 1] += ` ${current.trim()}`;
    index += 1;
  }
  return { html: renderList(items, firstEntry.ordered), nextIndex: index };
}

function consumeParagraph(lines, startIndex) {
  const paragraph = [];
  let index = startIndex;
  while (
    index < lines.length &&
    lines[index].trim().length > 0 &&
    !lines[index].startsWith("```") &&
    !isTableRow(lines[index]) &&
    !parseHeading(lines[index]) &&
    !isListItem(lines[index])
  ) {
    paragraph.push(lines[index].trim());
    index += 1;
  }
  const text = paragraph.join(" ");
  const html = /^!\[[^\]]*]\([^)]+\)$/.test(text)
    ? `<figure>${renderInline(text)}</figure>`
    : `<p>${renderInline(text)}</p>`;
  return { html, nextIndex: index };
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
    const headingHtml = renderHeading(line, headings, usedHeadingIds);
    if (headingHtml) {
      html.push(headingHtml);
      index += 1;
      continue;
    }
    const block =
      consumeFence(lines, index, renderFence) ??
      consumeTable(lines, index) ??
      consumeList(lines, index) ??
      consumeParagraph(lines, index);
    html.push(block.html);
    index = block.nextIndex;
  }
  return { html: html.join("\n"), headings };
}
