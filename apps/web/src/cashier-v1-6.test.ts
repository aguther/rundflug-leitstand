import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import apiSource from "./api.ts?raw";
import cashierSource from "./cashier-view.tsx?raw";

const ticketPresentationSource = readFileSync(
  new URL("./features/cashier/CashierTicketPresentation.tsx", import.meta.url),
  "utf8",
);
const viewPresentationSource = readFileSync(
  new URL("./features/cashier/CashierViewPresentation.tsx", import.meta.url),
  "utf8",
);
const tablePresentationSource = readFileSync(
  new URL("./features/cashier/CashierTablePresentation.tsx", import.meta.url),
  "utf8",
);
const cashierFeatureSource = [
  cashierSource,
  ticketPresentationSource,
  viewPresentationSource,
  tablePresentationSource,
].join("\n");

const styles = readFileSync(new URL("./features/cashier/cashier-v12.css", import.meta.url), "utf8");

describe("cashier release 1.7.0 acceptance coverage", () => {
  it("refreshes and paginates the operational ticket list", () => {
    expect(apiSource).toContain('params.set("status"');
    expect(apiSource).toContain('params.set("cursor"');
    expect(apiSource).toContain('params.append("id"');
    expect(apiSource).toContain('params.set("soldByAccountId"');
    expect(cashierSource).toContain("IntersectionObserver");
    expect(cashierSource).toContain('window.addEventListener("focus"');
    expect(cashierSource).toContain("board?.event.version");
    expect(cashierSource).toContain("preserveLoaded: true");
  });

  it("uses compact product rows and one shared group-size control", () => {
    expect(cashierSource).toContain('className="cashier-group-size"');
    expect(cashierSource).toContain('className="cashier-product-row"');
    expect(cashierSource).toContain("board?.products.map");
    expect(cashierSource).not.toContain("aria-expanded");
    expect(cashierSource).not.toContain("scrollIntoView");
    expect(cashierSource).not.toContain("cashier-product-body");
    expect(cashierSource).not.toContain("Gewichtsklasse (pro Person)");
    expect(cashierSource).not.toContain("Ticket-Ausgabe");
  });

  it("reserves the split-warning line without expanding a product", () => {
    expect(cashierSource).toContain("cashier-split-line");
    expect(cashierSource).toContain("aufeinanderfolgenden Fluggruppen");
    expect(styles).toMatch(/\.cashier-split-line \{[\s\S]*?block-size: 2\.8rem;/);
    expect(styles).toContain("-webkit-line-clamp: 2");
  });

  it("preserves the ticket count after a sale and resets only on explicit request", () => {
    expect(cashierSource).not.toContain("setSize(1)");
    expect(cashierSource).toContain('label="Gruppengröße auf 1 zurücksetzen"');
    expect(cashierSource).toContain("onClick={() => changeGroupSize(1)}");
  });

  it("fits the complete cashier workspace into the iPad landscape band", () => {
    expect(styles).toMatch(/@media \(min-width: 1101px\) and \(max-width: 1250px\)/);
    expect(styles).toMatch(
      /@media \(min-width: 1101px\)[\s\S]*?\.cashier-product-row \{[\s\S]*?minmax\(0, 1\.3fr\)[\s\S]*?minmax\(104px, 0\.9fr\)/,
    );
    expect(cashierSource).not.toContain('<Plane aria-hidden="true" />');
    expect(styles).toMatch(
      /@media \(min-width: 1101px\)[\s\S]*?\.cashier-ticket-table \.ds-table \{[\s\S]*?min-width: 740px;/,
    );
  });

  it("keeps seller filtering inside the existing right-hand ticket workspace", () => {
    expect(cashierSource).toContain('className="cashier-v15-workspace"');
    expect(cashierSource).toContain('className="cashier-sale-panel"');
    expect(cashierSource).toContain('className="ds-toolbar cashier-ticket-toolbar"');
    expect(cashierSource).toContain('aria-label="Nach Kassenkonto filtern"');
    expect(cashierSource).toContain('label="Nur meine Tickets"');
    expect(cashierSource).toContain('key: "cashier"');
    expect(cashierSource).toContain('soldByOperatorLoginCode ?? "Nicht zugeordnet"');
    expect(cashierSource).toContain("previousCashierAccountFilterRef.current");
    expect(styles).toMatch(/\.cashier-ticket-toolbar \{[\s\S]*?flex-wrap: wrap;/);
    expect(styles).toMatch(
      /\.cashier-ticket-toolbar \{[\s\S]*?--cashier-ticket-control-height: var\(--control-touch\);[\s\S]*?align-items: flex-end;/,
    );
    for (const selector of [
      ".cashier-ticket-toolbar > .ds-search-field",
      ".cashier-ticket-toolbar > .ds-icon-button",
      ".cashier-account-filter select",
      ".cashier-own-ticket-filter.ds-checkbox-field",
    ]) {
      expect(styles).toMatch(
        new RegExp(
          `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[\\s\\S]*?height: var\\(--cashier-ticket-control-height\\);`,
        ),
      );
    }
  });

  it("uses the outer ticket list as the single scroll owner", () => {
    expect(styles).toMatch(
      /\.cashier-ticket-table-wrap \{[\s\S]*?overflow: auto;[\s\S]*?scrollbar-gutter: stable;/,
    );
    expect(styles).toMatch(
      /\.cashier-ticket-table\.ds-table-scroll \{[\s\S]*?height: auto;[\s\S]*?overflow: visible;/,
    );
  });

  it("shows a complete compact preview and a dedicated QR scan dialog", () => {
    expect(cashierFeatureSource).toContain("function QrScanDialog");
    expect(cashierFeatureSource).toContain("dialog.showModal()");
    expect(cashierFeatureSource).toContain("QR-Code vergrößern");
    expect(cashierSource).toContain("width: 768");
    expect(styles).toMatch(/\.cashier-ticket-paper \{[\s\S]*?overflow: hidden;/);
    expect(styles).toContain(".ticket-paper-preview");
    expect(styles).toContain(".qr-scan-dialog::backdrop");
    expect(styles).toMatch(/\.ticket-paper-preview \{[\s\S]*?width: min\(260px,/);
    expect(styles).toMatch(/\.cashier-ticket-enlarge \{[\s\S]*?width: 40px;/);
    expect(cashierFeatureSource).toContain("<strong>{ticket.eventName}</strong>");
    expect(cashierFeatureSource).not.toContain("<strong>Rundflug-Leitstand</strong>");
  });

  it("keeps large sale totals in a stable two-line label", () => {
    expect(cashierSource).toContain('className="cashier-sell-copy"');
    expect(styles).toMatch(/\.cashier-sell-action\.ds-button \{[\s\S]*?height: 48px;/);
    expect(styles).toMatch(/\.cashier-sell-copy \{[\s\S]*?grid-template-rows: repeat\(2,/);
    expect(styles).toContain("font-variant-numeric: tabular-nums");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 2fr)");
    expect(styles).toMatch(/\.cashier-sell-copy \{[\s\S]*?text-align: center;/);
  });

  it("uses visible selection state instead of informational selection toasts", () => {
    expect(cashierSource).not.toContain("Tickets ausgewählt.");
    expect(cashierSource).not.toContain("Ticketzettel stehen zum Nachdruck bereit.");
    expect(cashierSource).toContain("selectedRowKey");
    expect(cashierFeatureSource).toContain('title="QR-Code vergrößern"');
  });
});
