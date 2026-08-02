import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import displaySource from "../../fids-display.tsx?raw";

const stylesSource = readFileSync(new URL("./fids-v12.css", import.meta.url), "utf8");

describe("V1.7.3 FIDS concept fidelity", () => {
  it("matches the approved header, table and restrained settings control hierarchy", () => {
    expect(displaySource.match(/<BrandMark theme=\{logoTheme\} \/>/g)).toHaveLength(1);
    expect(displaySource).toContain('className="fids-title"');
    expect(displaySource).toContain('className="fids-footer-copy"');
    expect(displaySource).toContain('aria-label="FIDS-Einstellungen öffnen"');
    expect(stylesSource).toContain("opacity: 0.62");
    expect(stylesSource).toContain("border-radius: 0");
    expect(stylesSource).toContain("--brand-accent: #ffb020");
  });

  it("supports system, light and dark without a second display profile", () => {
    expect(stylesSource).toContain('data-fids-theme="light"');
    expect(stylesSource).toContain('data-fids-theme="system"');
    expect(stylesSource).toContain("prefers-color-scheme: light");
    expect(stylesSource).not.toContain(".terminal-fids");
  });

  it("combines group and flight on compact displays without horizontal overflow", () => {
    expect(displaySource).toContain("<small title={group.productName}>");
    expect(displaySource).toContain('className="visually-hidden">Kein Gate</span>');
    expect(stylesSource).toContain("@media (max-width: 900px)");
    expect(stylesSource).toMatch(
      /\.fids-product-cell,[\s\S]*?\.fids-gate-cell \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
    );
    expect(stylesSource).not.toContain("overflow-x: auto");
  });

  it("keeps split headings inside their fixed grid track despite legacy header styles", () => {
    expect(stylesSource).toMatch(
      /\.standard-fids \.fids-section-heading \{[\s\S]*?min-height: 0;[\s\S]*?padding-block: 0;/,
    );
    expect(stylesSource).not.toMatch(/\n\.fids-section-heading \{/);
  });

  it("keeps an empty fixed page at its configured physical row capacity", () => {
    expect(stylesSource).toMatch(
      /\.fids-board-section \{[\s\S]*?height: 100%;[\s\S]*?min-height: 0;/,
    );
    expect(stylesSource).toMatch(
      /\.fids-single-board,\s*\.fids-double-board \{[\s\S]*?min-height: 0;/,
    );
  });

  it("uses the approved unframed Lucide symbols and neutral passive information", () => {
    for (const icon of ["Users", "Clock3", "CircleArrowRight", "TicketsPlane", "PlaneTakeoff"]) {
      expect(displaySource).toContain(icon);
    }
    expect(displaySource).toContain("icon: CircleArrowRight");
    expect(displaySource).toContain("icon: TicketsPlane");
    expect(displaySource).toContain("icon: PlaneTakeoff");
    expect(displaySource).toContain(
      'return { label: "BEREITHALTEN", tone: "prepare", icon: Clock3 }',
    );
    expect(displaySource).toContain('return { label: "WARTEN", tone: "standby", icon: Clock3 }');
    expect(displaySource).toContain('<Users aria-hidden="true" />');
    expect(displaySource).toContain('<Icon aria-hidden="true" className="fids-status-icon" />');
    expect(displaySource).toContain('data-recall-active={group.activeRecall ? "true" : "false"}');
    expect(displaySource).toContain("<span>NACHRUF</span>");
    expect(stylesSource).toContain("@keyframes fids-primary-status-swap");
    expect(displaySource).not.toContain('<span className="fids-status-icon">');
    expect(stylesSource).toMatch(
      /\.fids-status-icon \{[\s\S]*?width: 1em;[\s\S]*?height: 1em;[\s\S]*?stroke-width: 2;/,
    );
    expect(stylesSource).not.toMatch(/\.fids-status-icon \{[^}]*border:/);
    expect(stylesSource).toMatch(/\.tone-standby \{\s*color: var\(--fids-text\);/);
    expect(stylesSource).toMatch(/\.tone-prepare \{\s*color: var\(--fids-blue\);/);
    expect(stylesSource).toMatch(
      /\.standard-fids \.fids-footer-copy > i \{[\s\S]*?background: var\(--fids-muted\);[\s\S]*?opacity: 0\.55;/,
    );
  });

  it("crossfades recall copy and icons at the regular status size", () => {
    expect(stylesSource).toContain("--fids-status-font-size: 1.04em");
    expect(stylesSource).toMatch(
      /\.fids-status \{[\s\S]*?font-size: var\(--fids-status-font-size\);/,
    );
    expect(stylesSource).toMatch(
      /\.fids-recall-status \{[\s\S]*?font-size: var\(--fids-status-font-size\);/,
    );

    const regularStatusRule = stylesSource.match(/\.fids-status \{(?<body>[^}]*)\}/)?.groups?.body;
    const recallStatusRule = stylesSource.match(/\.fids-recall-status \{(?<body>[^}]*)\}/)?.groups
      ?.body;
    const sharedIconGap = "gap: clamp(3px, 0.55vw, 10px)";
    expect(regularStatusRule).toContain(sharedIconGap);
    expect(recallStatusRule).toContain(sharedIconGap);
    expect(stylesSource).toMatch(/\.fids-recall-bell \{[\s\S]*?width: 1em;[\s\S]*?height: 1em;/);

    const pulseFrames = stylesSource.slice(
      stylesSource.indexOf("@keyframes fids-recall-pulse"),
      stylesSource.indexOf("@keyframes fids-primary-status-swap"),
    );
    const pulseScales = [...pulseFrames.matchAll(/scale\(([\d.]+)\)/g)].map((match) =>
      Number(match[1]),
    );
    expect(Math.min(...pulseScales)).toBeCloseTo(0.89);
    expect(Math.max(...pulseScales)).toBe(1);
    expect(stylesSource).toContain("animation: fids-primary-status-swap 8s ease-in-out infinite");
    expect(stylesSource).toContain("animation: fids-recall-status-swap 8s ease-in-out infinite");
    expect(stylesSource).not.toContain("step-end");

    const primaryFrames = stylesSource.slice(
      stylesSource.indexOf("@keyframes fids-primary-status-swap"),
      stylesSource.indexOf("@keyframes fids-recall-status-swap"),
    );
    const recallFrames = stylesSource.slice(
      stylesSource.indexOf("@keyframes fids-recall-status-swap"),
      stylesSource.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(primaryFrames).toContain("45%");
    expect(primaryFrames).toContain("95%");
    expect(primaryFrames).toMatch(/45%,[\s\S]*?opacity: 1;[\s\S]*?50%,[\s\S]*?opacity: 0;/);
    expect(recallFrames).toMatch(/45%,[\s\S]*?opacity: 0;[\s\S]*?50%,[\s\S]*?opacity: 1;/);
    expect(stylesSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.fids-status-cell\[data-recall-active="true"\] > \.fids-status \{[\s\S]*?opacity: 0;[\s\S]*?animation: none;/,
    );
    expect(stylesSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.fids-status-cell\[data-recall-active="true"\] > \.fids-recall-status \{[\s\S]*?opacity: 1;[\s\S]*?animation: none;/,
    );
  });

  it("draws a complete layout-neutral recall outline for every row position", () => {
    const activeRule = stylesSource.match(
      /\.fids-row\[data-recall-active="true"\] \{(?<body>[^}]*)\}/,
    )?.groups?.body;
    expect(activeRule).toContain(
      "box-shadow: inset 0 0 0 clamp(2px, 0.24vw, 5px) var(--fids-orange)",
    );
    expect(activeRule).not.toContain("border");
    expect(activeRule).not.toContain(":last-child");
    expect(stylesSource).toMatch(
      /\.fids-row \{[\s\S]*?border: 1px solid var\(--fids-border\);[\s\S]*?border-bottom: 0;/,
    );
    expect(stylesSource).toMatch(
      /\.fids-row:last-child \{\s*border-bottom: 1px solid var\(--fids-border\);/,
    );
    expect(stylesSource).toContain('.standard-fids[data-fids-layout="double"] .fids-table-body');
  });
});
