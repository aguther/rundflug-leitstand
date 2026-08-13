import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const completionStyles = readFileSync(
  new URL("./features/admin/completion/completion-workspace.css", import.meta.url),
  "utf8",
);
const analysisStyles = readFileSync(
  new URL("./features/analysis/analysis-workspace.css", import.meta.url),
  "utf8",
);
const eventWorkspaceStyles = readFileSync(
  new URL("./features/admin/admin-event-workspace.css", import.meta.url),
  "utf8",
);
const legacyStyleSources = [
  readFileSync(new URL("./styles.css", import.meta.url), "utf8"),
  readFileSync(new URL("./features/admin/admin-v12-fixed-workspace.css", import.meta.url), "utf8"),
  readFileSync(new URL("./features/admin/admin-modernization.css", import.meta.url), "utf8"),
];

describe("admin secondary layout finish", () => {
  it("keeps completion filters theme-owned, responsive, and fully contained", () => {
    expect(completionStyles).toMatch(
      /\.completion-history-panel \.history-filters \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?overflow: visible;[\s\S]*?border: 1px solid var\(--ui-border\);[\s\S]*?background: var\(--ui-surface-subtle\);/,
    );
    expect(completionStyles).toMatch(
      /\.history-visible-filters \{[\s\S]*?repeat\(auto-fit, minmax\(min\(100%, 300px\), 1fr\)\);/,
    );
    expect(completionStyles).toMatch(
      /\.history-filter-disclosures \{[\s\S]*?repeat\(auto-fit, minmax\(min\(100%, 280px\), 1fr\)\);/,
    );
    expect(completionStyles).toMatch(
      /\.completion-history-panel \.history-filters :is\(input, select\) \{[\s\S]*?min-height: 44px;[\s\S]*?background: var\(--ui-control\);/,
    );
    expect(completionStyles).not.toMatch(/\.history-filters[^}]*#[0-9a-f]{3,8}/i);
    expect(legacyStyleSources.every((source) => !source.includes(".history-filters"))).toBe(true);
  });

  it("aligns corrections and evaluation content with desktop and compact gutters", () => {
    expect(completionStyles).toMatch(/\.completion-correction-panel \{[\s\S]*?margin: 16px;/);
    expect(completionStyles).toMatch(
      /@media \(max-width: 760px\) \{[\s\S]*?\.completion-correction-panel \{[\s\S]*?margin: 12px;/,
    );
    expect(analysisStyles).toMatch(/\.analysis-workspace \{[\s\S]*?margin: 0 16px 24px;/);
    expect(analysisStyles).toMatch(
      /\.analysis-workspace > \.ds-tabs,[\s\S]*?height: 48px;[\s\S]*?min-height: 48px;/,
    );
    expect(analysisStyles).toMatch(
      /@media \(max-width: 760px\) \{[\s\S]*?\.analysis-workspace \{[\s\S]*?margin: 0 12px 16px;/,
    );
    expect(analysisStyles).toContain(".analysis-archives-message:empty");
    expect(analysisStyles).not.toMatch(/\.analysis-snapshot-status \{[^}]*min-height:/);
  });

  it("themes only the event workspace main scrollbar", () => {
    const scopedSelector = ".admin-shell .admin-workspace--events > .admin-workspace-scroll-region";

    expect(eventWorkspaceStyles).toContain(`${scopedSelector} {`);
    expect(eventWorkspaceStyles).toMatch(
      /\.admin-workspace--events > \.admin-workspace-scroll-region \{[\s\S]*?scrollbar-width: thin;[\s\S]*?scrollbar-color: color-mix\(/,
    );
    expect(eventWorkspaceStyles).toContain(`${scopedSelector}::-webkit-scrollbar-thumb`);
    expect(eventWorkspaceStyles).not.toContain(
      ".admin-shell .admin-workspace-scroll-region::-webkit-scrollbar-thumb",
    );
    expect(eventWorkspaceStyles).not.toMatch(
      /(?:history-table-wrap|analysis-archives-table-scroll)::?-webkit-scrollbar/,
    );
  });
});
