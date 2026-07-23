import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import displaySource from "../../fids-display.tsx?raw";

const stylesSource = readFileSync(new URL("./fids-v12.css", import.meta.url), "utf8");

describe("V1.7.3 FIDS concept fidelity", () => {
  it("matches the approved header, table and restrained settings control hierarchy", () => {
    expect(displaySource.match(/<BrandMark \/>/g)).toHaveLength(1);
    expect(displaySource).toContain('className="fids-title"');
    expect(displaySource).toContain('className="fids-footer-copy"');
    expect(displaySource).toContain('aria-label="FIDS-Einstellungen öffnen"');
    expect(stylesSource).toContain("opacity: 0.62");
    expect(stylesSource).toContain("border-radius: 0");
    expect(stylesSource).toContain("stroke-width: 1.35");
  });

  it("supports system, light and dark without a second display profile", () => {
    expect(stylesSource).toContain('data-fids-theme="light"');
    expect(stylesSource).toContain('data-fids-theme="system"');
    expect(stylesSource).toContain("prefers-color-scheme: light");
    expect(stylesSource).not.toContain(".terminal-fids");
  });

  it("combines group and flight on compact displays without horizontal overflow", () => {
    expect(displaySource).toContain("<small>{group.productName}</small>");
    expect(stylesSource).toContain("@media (max-width: 900px)");
    expect(stylesSource).toContain("overflow-wrap: anywhere");
    expect(stylesSource).not.toContain("overflow-x: auto");
  });
});
