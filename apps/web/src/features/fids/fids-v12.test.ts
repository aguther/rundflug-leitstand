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

  it("uses the approved unframed Lucide symbols and neutral passive information", () => {
    for (const icon of ["Users", "Clock3", "CircleArrowRight", "TicketsPlane", "PlaneTakeoff"]) {
      expect(displaySource).toContain(icon);
    }
    expect(displaySource).toContain("icon: CircleArrowRight");
    expect(displaySource).toContain("icon: TicketsPlane");
    expect(displaySource).toContain("icon: PlaneTakeoff");
    expect(displaySource).toContain('return { label: "WARTEN", tone: "standby", icon: Clock3 }');
    expect(displaySource).toContain('<Users aria-hidden="true" />');
    expect(displaySource).toContain('<Icon aria-hidden="true" className="fids-status-icon" />');
    expect(displaySource).not.toContain('<span className="fids-status-icon">');
    expect(stylesSource).toMatch(
      /\.fids-status-icon \{[\s\S]*?width: 1em;[\s\S]*?height: 1em;[\s\S]*?stroke-width: 2;/,
    );
    expect(stylesSource).not.toMatch(/\.fids-status-icon \{[^}]*border:/);
    expect(stylesSource).toMatch(/\.tone-standby \{\s*color: var\(--fids-text\);/);
    expect(stylesSource).toMatch(
      /\.standard-fids \.fids-footer-copy > i \{[\s\S]*?background: var\(--fids-muted\);[\s\S]*?opacity: 0\.55;/,
    );
  });
});
