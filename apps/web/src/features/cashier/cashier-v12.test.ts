import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "../../cashier-view.tsx?raw";

const stylesSource = readFileSync(new URL("./cashier-v12.css", import.meta.url), "utf8");
const tabletLandscapeStart = stylesSource.search(
  /@media\s*\(min-width:\s*1101px\)[^{}]*\(max-height:\s*900px\)/,
);
const stackedLayoutStart = stylesSource.indexOf("@media (max-width: 1100px)");
const tabletLandscapeStyles =
  tabletLandscapeStart >= 0 && stackedLayoutStart > tabletLandscapeStart
    ? stylesSource.slice(tabletLandscapeStart, stackedLayoutStart)
    : "";

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
    expect(appSource).toContain('label="Gruppengröße auf 1 zurücksetzen"');
    expect(appSource).toContain("onClick={() => changeGroupSize(1)}");
    expect(appSource).toContain("disabled={size === 1 || busyProductId !== null}");
    expect(appSource).toContain('<RotateCcw aria-hidden="true" size={18} />');
    expect(stylesSource).toMatch(
      /\.cashier-size-reset\.ds-icon-button,[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/,
    );
  });

  it("keeps stepper and reset together while aligning the cashier-order action right", () => {
    expect(appSource).toContain('className="cashier-group-size-main"');
    expect(appSource).toContain('className="cashier-group-actions"');
    expect(appSource).toMatch(
      /className="cashier-group-size-main"[\s\S]*?className="cashier-stepper"[\s\S]*?className="cashier-size-reset"[\s\S]*?className="cashier-group-actions"/,
    );
    expect(appSource).toMatch(
      /className="cashier-group-actions"[\s\S]*?className="cashier-order-open"/,
    );
    expect(stylesSource).toMatch(
      /\.cashier-group-actions\s*\{[^}]*display:\s*flex;[^}]*margin-inline-start:\s*auto;/s,
    );
    expect(stylesSource).toMatch(
      /@media \(max-width:\s*700px\)\s*\{[\s\S]*?\.cashier-group-size\s*\{[^}]*width:\s*100%;/,
    );
  });

  it("defines a touch-only landscape tablet stage without changing stacked breakpoints [V15-UI-020, V161-UI-010]", () => {
    expect(tabletLandscapeStyles).toMatch(/\(min-width:\s*1101px\)/);
    expect(tabletLandscapeStyles).toMatch(/and\s*\(max-width:\s*1250px\)/);
    expect(tabletLandscapeStyles).toMatch(/and\s*\(max-height:\s*900px\)/);
    expect(tabletLandscapeStyles).toMatch(/and\s*\(\s*orientation:\s*landscape\s*\)/);
    expect(tabletLandscapeStyles).toMatch(/and\s*\(any-pointer:\s*coarse\)/);
    expect(tabletLandscapeStyles).toMatch(
      /\.cashier-sale-heading\s*\{[^}]*align-items:\s*stretch;[^}]*flex-direction:\s*column;/s,
    );
    expect(tabletLandscapeStyles).toMatch(
      /\.cashier-stepper \.ds-icon-button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s,
    );
    expect(stylesSource).toContain("@media (max-width: 1100px)");
    expect(stylesSource).toContain("@media (max-width: 700px)");
  });

  it("protects cashier tabs and uses a deterministic tablet filter grid [V161-UI-010]", () => {
    expect(tabletLandscapeStyles).toMatch(
      /\.cashier-ticket-panel > \.ds-tabs\s*\{[^}]*height:\s*48px;[^}]*min-height:\s*48px;[^}]*overflow-y:\s*hidden;/s,
    );
    expect(tabletLandscapeStyles).toMatch(
      /\.cashier-ticket-panel > \.ds-tabs > button\s*\{[^}]*height:\s*48px;[^}]*min-height:\s*48px;/s,
    );
    expect(tabletLandscapeStyles).toMatch(
      /\.cashier-ticket-toolbar\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:[^}]*minmax\(180px, 1fr\)[^}]*minmax\(140px, 0\.65fr\)[^}]*max-content[^}]*var\(--control-touch\);[^}]*flex-wrap:\s*nowrap;/s,
    );
    expect(tabletLandscapeStyles).toMatch(
      /\.cashier-ticket-toolbar > \.ds-search-field\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*initial;/s,
    );
  });

  it("reserves tablet rows and clears nested automatic minimum sizes [Q-UX-010, V1100-QA-010]", () => {
    expect(tabletLandscapeStyles).toMatch(
      /\.cashier-ticket-panel\s*\{[^}]*min-height:\s*0;[^}]*grid-template-rows:\s*48px max-content minmax\(120px, 0\.65fr\) minmax\(280px, 1\.35fr\);/s,
    );
    expect(tabletLandscapeStyles).toMatch(
      /\.cashier-ticket-table-wrap,[\s\S]*?\.cashier-ticket-detail,[\s\S]*?\.cashier-ticket-detail-grid,[\s\S]*?\.cashier-ticket-detail-grid > \*\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*0;/,
    );
  });

  it("edits only the cashier order with accessible icon controls", () => {
    expect(appSource).toContain('label="Kassenreihenfolge bearbeiten"');
    expect(appSource).toContain('<ListOrdered aria-hidden="true" size={19} />');
    expect(appSource).toContain('type: "REORDER_CASHIER_PRODUCTS"');
    expect(appSource).toContain("expectedProductIds: expectedCashierProductIds");
    expect(appSource).toContain("orderedProductIds: orderedCashierProductIds");
    expect(appSource).toContain(
      "Nur Kassenreihenfolge · FIDS, Queue und operative Priorität bleiben dynamisch",
    );
    expect(appSource).toContain("draggable");
    expect(appSource).toContain("nach oben verschieben");
    expect(appSource).toContain("nach unten verschieben");
    expect(appSource).toContain("disabled={!cashierOrderHasChanged}");
  });

  it("releases the next sale after persistence while view and receipt sync in background", () => {
    const sellSource = appSource.slice(
      appSource.indexOf("async function sell("),
      appSource.indexOf("async function cancelLastSale"),
    );
    expect(sellSource).toContain("setBusyProductId(null)");
    expect(sellSource).toContain("setSaleSyncCount");
    expect(sellSource).toContain("Promise.allSettled");
    expect(sellSource).toContain("mergeTicketGroupsById");
    expect(sellSource.indexOf("setBusyProductId(null)")).toBeLessThan(
      sellSource.indexOf("Promise.allSettled"),
    );
    expect(appSource).toContain("receiptRequestRef");
    expect(appSource).toContain("rundflug:cashier-sale-ready");
  });

  it("keeps routine sale success out of visible messages while retaining partial failures", () => {
    expect(appSource).not.toContain("verkauft. Ansicht und Beleg werden aktualisiert.`");
    expect(appSource).not.toMatch(
      /setMessage\(\s*`\$\{codes\.length\} Ticket\$\{codes\.length === 1 \? "" : "s"\} verkauft\.`/,
    );
    expect(appSource).toContain(
      "Ansicht oder Druckvorbereitung wird weiter nachgeladen; Nachdruck bleibt möglich.",
    );
    expect(appSource).toContain(
      "Der lokale Entwurf konnte noch nicht bereinigt werden; Ansicht und Beleg werden aktualisiert.",
    );
    expect(appSource).toContain("mergeTicketGroupsById([soldTicketGroupId])");
    expect(appSource).toContain('className="visually-hidden"');
    expect(appSource).toContain('aria-live="polite"');
  });

  it("marks newly confirmed ticket groups independently from selection", () => {
    expect(appSource).toContain("useTemporaryRowHighlights");
    expect(appSource).toContain("queueSaleHighlight(soldTicketGroupId)");
    expect(appSource).toContain("rowClassName={(result) =>");
    expect(appSource).toContain("cashier-ticket-row--new");
    expect(stylesSource).toContain("animation: cashier-new-ticket-row 3s ease-out both");
    expect(stylesSource).toContain("@keyframes cashier-new-ticket-row");
    expect(stylesSource).toContain("@keyframes cashier-new-selected-ticket-row");
    expect(stylesSource).toContain("inset 3px 0 0 var(--ui-success)");
    expect(stylesSource).toContain("inset 6px 0 0 var(--ui-accent)");
    expect(stylesSource).not.toContain("var(--ui-success-soft)");
    expect(stylesSource).toContain("@media (prefers-reduced-motion: reduce)");
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
    expect(stylesSource).toMatch(
      /\.ticket-print-document \.ticket-paper \{[\s\S]*?width: 56mm;[\s\S]*?padding: 1mm;/,
    );
    expect(stylesSource).toMatch(
      /\.ticket-print-document \.ticket-paper > img \{[\s\S]*?width: 52mm;[\s\S]*?height: 52mm;/,
    );
    expect(stylesSource).toMatch(
      /\.ticket-print-document \.ticket-paper > strong \{[\s\S]*?font-size: 14pt;[\s\S]*?line-height: 1\.2;/,
    );
    expect(stylesSource).toMatch(
      /\.ticket-print-document \.ticket-paper > small \{[\s\S]*?font-size: 10pt;[\s\S]*?line-height: 1\.2;/,
    );
    expect(stylesSource).toMatch(
      /\.ticket-print-document \.ticket-paper > b \{[\s\S]*?font-size: 14pt;[\s\S]*?line-height: 1\.2;/,
    );
    expect(stylesSource).toMatch(
      /\.ticket-print-document \.ticket-paper dl \{[\s\S]*?font-size: 11pt;[\s\S]*?line-height: 1\.2;/,
    );
    expect(stylesSource).toMatch(
      /\.ticket-print-document \.ticket-paper dl > div \{[\s\S]*?grid-template-columns: 18mm minmax\(0, 1fr\);[\s\S]*?column-gap: 1mm;/,
    );
    expect(stylesSource).toMatch(
      /\.ticket-print-document \.ticket-paper :is\(strong, b, small, dt, dd\) \{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/,
    );
    expect(stylesSource).toMatch(
      /\.ticket-paper-preview > img \{[\s\S]*?width: min\(144px, 58%\);/,
    );
  });

  it("falls back to natural document flow on tablet-sized stacked layouts", () => {
    expect(stylesSource).toMatch(
      /@media \(max-width: 1100px\) \{[\s\S]*?\.cashier-shell \{[\s\S]*?height: auto;[\s\S]*?overflow: visible;/,
    );
  });
});
