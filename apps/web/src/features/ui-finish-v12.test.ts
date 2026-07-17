import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import mainSource from "../main.tsx?raw";

const stylesSource = readFileSync(new URL("./ui-finish-v12.css", import.meta.url), "utf8");

describe("V1.2 visual finish", () => {
  it("loads the finish layer after every feature surface", () => {
    expect(mainSource.indexOf('import "./features/fids/fids-v12.css"')).toBeLessThan(
      mainSource.indexOf('import "./features/ui-finish-v12.css"'),
    );
  });

  it("provides polished controls, panels and responsive Assist actions", () => {
    expect(stylesSource).not.toMatch(/(?:linear|radial)-gradient\(/);
    expect(stylesSource).toContain("var(--ui-shadow-soft)");
    expect(stylesSource).toContain(".assist-actions button");
    expect(stylesSource).toContain(".console-toolbar details > summary");
    expect(stylesSource).toContain(".admin-shell .admin-workspace.master-data-active");
  });

  it("keeps inactive administration sections hidden and styles device actions", () => {
    expect(stylesSource).toMatch(/\.admin-shell \[hidden\]\s*\{\s*display: none;/);
    expect(stylesSource).toContain(".admin-revoke-action");
    expect(stylesSource).toContain(".admin-section");
  });
});
