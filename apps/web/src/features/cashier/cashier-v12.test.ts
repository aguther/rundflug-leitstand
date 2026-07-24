import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "../../cashier-view.tsx?raw";

const stylesSource = readFileSync(new URL("./cashier-v12.css", import.meta.url), "utf8");

describe("V1.7.0 cashier", () => {
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

  it("keeps every split warning and product sale action geometrically stable", () => {
    expect(appSource).toContain("cashier-split-line");
    expect(appSource).toContain("Aufteilung:");
    expect(appSource).not.toContain("cashier-product-body");
    expect(appSource).toContain("onClick={() => void sell(entry)}");
    expect(appSource).toContain('<Ticket aria-hidden="true" size={20} />');
    expect(appSource).not.toContain('<Plane aria-hidden="true" />');
    expect(stylesSource).toContain("block-size: 2.8rem");
    expect(stylesSource).toContain("overflow-x: clip");
    expect(stylesSource).toMatch(/minmax\(0, 1\.5fr\)[\s\S]*?minmax\(118px, 1fr\)/);
    expect(stylesSource).toMatch(/\.cashier-sell-action\.ds-button \{[\s\S]*?width: 100%;/);
    expect(stylesSource).toMatch(
      /\.cashier-sell-action\.ds-button > \.ds-button-content \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 2fr\);/,
    );
    expect(stylesSource).toMatch(
      /\.cashier-sell-action\.ds-button > \.ds-button-content > svg \{[\s\S]*?justify-self: center;/,
    );
  });

  it("keeps the selected group size after a sale and exposes an explicit reset", () => {
    expect(appSource).not.toContain("setSize(1);");
    expect(appSource).toContain('aria-label="Gruppengröße auf 1 zurücksetzen"');
    expect(appSource).toContain("onClick={() => changeGroupSize(1)}");
    expect(appSource).toContain("disabled={size === 1 || busyProductId !== null}");
    expect(appSource).toContain("Zurücksetzen");
  });

  it("keeps forecast capacity advisory instead of disabling an explicitly enabled sale", () => {
    const disabledRule = appSource.slice(
      appSource.indexOf("const saleDisabled ="),
      appSource.indexOf("return (", appSource.indexOf("const saleDisabled =")),
    );
    expect(disabledRule).not.toContain("saleRecommended");
    expect(disabledRule).not.toContain("remainingSellableSeats");
    expect(disabledRule).toContain('entry.resourceGroupStatus !== "ACTIVE"');
    expect(disabledRule).toContain("board.event.emergencyMode");
  });

  it("renders one shared ticket component without fixed POS-58 paper length", () => {
    expect(appSource).toContain("function TicketPaper");
    expect(appSource).toContain("function QrScanDialog");
    expect(appSource).toContain('className="ticket-print-document"');
    expect(appSource).toContain("images.length !== 1");
    expect(stylesSource).toMatch(/@page \{[\s\S]*?margin: 0;/);
    expect(stylesSource).not.toContain("min-height: 100mm");
    expect(stylesSource).not.toContain("size: 58mm 110mm");
    expect(stylesSource).not.toContain("break-after: page");
    expect(stylesSource).toContain("width: 48mm");
    expect(stylesSource).toMatch(
      /html,[\s\S]*?body,[\s\S]*?#root \{[\s\S]*?width: 100% !important;/,
    );
    expect(stylesSource).toMatch(/\.cashier-shell \{[\s\S]*?width: 100%;/);
    expect(stylesSource).toMatch(
      /\.cashier-shell > \*:not\(\.ticket-print-document\) \{[\s\S]*?display: none !important;/,
    );
    expect(stylesSource).toMatch(
      /\.cashier-shell > \.ticket-print-document \{[\s\S]*?width: 100%;[\s\S]*?justify-content: center;/,
    );
    expect(stylesSource).toMatch(/\.ticket-print-document \.ticket-paper \{[\s\S]*?width: 52mm;/);
    expect(stylesSource).toMatch(
      /\.ticket-print-document \.ticket-paper dl > div \{[\s\S]*?grid-template-columns: 18mm minmax\(0, 1fr\);[\s\S]*?column-gap: 1mm;/,
    );
  });

  it("falls back to natural document flow on tablet-sized stacked layouts", () => {
    expect(stylesSource).toMatch(
      /@media \(max-width: 1100px\) \{[\s\S]*?\.cashier-shell \{[\s\S]*?height: auto;[\s\S]*?overflow: visible;/,
    );
  });
});
