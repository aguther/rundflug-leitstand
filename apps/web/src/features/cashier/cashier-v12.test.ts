import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "../../cashier-view.tsx?raw";

const stylesSource = readFileSync(new URL("./cashier-v12.css", import.meta.url), "utf8");

describe("V1.6.1 cashier", () => {
  it("uses the authenticated cashier session without another PIN prompt", () => {
    expect(appSource).toContain('className="cashier-shell"');
    expect(appSource).not.toContain("Administrator-PIN für Storno/Umbuchung");
    expect(appSource).not.toContain("REBOOK_TICKET_GROUP");
    expect(appSource).not.toContain(">Umbuchen<");
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
    expect(stylesSource).toContain("grid-template-columns: 0.85fr 1.4fr");
  });

  it("keeps product guidance and the product sale action geometrically stable", () => {
    expect(appSource).toContain("cashier-product-guidance");
    expect(appSource).toContain("Passt in einen Umlauf");
    expect(appSource).toContain("Aufteilung erforderlich");
    expect(appSource).not.toContain("Aufteilung verstanden");
    expect(appSource).toContain("onClick={() => void sell(entry)}");
    expect(stylesSource).toContain("grid-template-rows: auto 4.75rem 56px");
    expect(stylesSource).toContain("block-size: 4.75rem");
  });

  it("renders one shared ticket component for preview and every print page", () => {
    expect(appSource).toContain("function TicketPaper");
    expect(appSource).toContain('className="ticket-print-document"');
    expect(appSource).toContain("images.length !== receipt.length");
    expect(stylesSource).toContain("break-after: page");
    expect(stylesSource).toContain("width: 44mm");
  });

  it("falls back to natural document flow on tablet-sized stacked layouts", () => {
    expect(stylesSource).toMatch(
      /@media \(max-width: 1100px\) \{[\s\S]*?\.cashier-shell \{[\s\S]*?height: auto;[\s\S]*?overflow: visible;/,
    );
  });
});
