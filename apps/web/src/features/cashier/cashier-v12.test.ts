import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "../../cashier-view.tsx?raw";

const stylesSource = readFileSync(new URL("./cashier-v12.css", import.meta.url), "utf8");

describe("V1.2 cashier", () => {
  it("uses the authenticated cashier session without another PIN prompt", () => {
    expect(appSource).toContain('className="cashier-shell"');
    expect(appSource).not.toContain("Administrator-PIN für Storno/Umbuchung");
    expect(appSource).toContain('adminPin: "SESSION"');
  });

  it("uses the V1.5 one-screen sales and ticket workspace", () => {
    expect(appSource).toContain("cashier-v15-workspace");
    expect(appSource).toContain("Verkaufte Tickets");
    expect(appSource).toContain("Stornierte Tickets");
    expect(stylesSource).toContain("height: 100dvh");
    expect(stylesSource).toContain("overflow: hidden");
    expect(stylesSource).toContain("grid-template-columns: minmax(430px");
    expect(stylesSource).toContain("var(--ui-surface)");
  });

  it("keeps correction actions compact instead of stretching them into implicit grid rows", () => {
    expect(stylesSource).toMatch(/\.cashier-ticket-detail\s*\{[^}]*display:\s*flex;/s);
    expect(stylesSource).toContain("flex: 1 1 auto");
    expect(stylesSource).toContain("grid-template-columns: 0.75fr 1fr 1.35fr");
  });

  it("falls back to natural document flow on tablet-sized stacked layouts", () => {
    expect(stylesSource).toMatch(
      /@media \(max-width: 1100px\) \{[\s\S]*?\.cashier-shell \{[\s\S]*?height: auto;[\s\S]*?overflow: visible;/,
    );
  });
});
