import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import displaySource from "../../fids-display.tsx?raw";

const stylesSource = readFileSync(new URL("./fids-v12.css", import.meta.url), "utf8");

describe("V1.2 FIDS concepts", () => {
  it("uses the common visual mark and keeps the two styles independently addressable", () => {
    expect(displaySource.match(/<BrandMark \/>/g)).toHaveLength(2);
    expect(displaySource).toContain('href="/fids/terminal?kiosk=1"');
    expect(displaySource).toContain('href="/fids?kiosk=1&style=standard"');
  });

  it("keeps terminal copy English and gives it a condensed split-flap treatment", () => {
    expect(displaySource).toContain("DEPARTURES");
    expect(displaySource).toContain("NEW WINDOW TO FOLLOW");
    expect(stylesSource).toContain('"Bahnschrift Condensed"');
    expect(stylesSource).toContain(".terminal-row::after");
  });

  it("supports the shared light and dark theme in the standard display", () => {
    expect(displaySource.match(/<ThemeToggle \/>/g)).toHaveLength(2);
    expect(stylesSource).toContain("var(--ui-bg)");
    expect(stylesSource).toContain("var(--ui-surface)");
  });
});
