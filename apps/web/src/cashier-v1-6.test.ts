import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import apiSource from "./api.ts?raw";
import cashierSource from "./cashier-view.tsx?raw";

const styles = readFileSync(new URL("./features/cashier/cashier-v12.css", import.meta.url), "utf8");

describe("cashier release 1.7.0 acceptance coverage", () => {
  it("refreshes and paginates the operational ticket list", () => {
    expect(apiSource).toContain('params.set("status"');
    expect(apiSource).toContain('params.set("cursor"');
    expect(apiSource).toContain('params.append("id"');
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

  it("resets the ticket count only on the successful sale path", () => {
    const successStart = cashierSource.indexOf("const soldTicketGroupId");
    const reset = cashierSource.indexOf("setSize(1)", successStart);
    const catchBlock = cashierSource.indexOf("} catch (reason)", successStart);
    expect(reset).toBeGreaterThan(successStart);
    expect(reset).toBeLessThan(catchBlock);
  });

  it("fits the complete cashier workspace into the iPad landscape band", () => {
    expect(styles).toMatch(/@media \(min-width: 1101px\) and \(max-width: 1250px\)/);
    expect(styles).toMatch(
      /grid-template-columns:[\s\S]*?26px minmax\(82px, 1\.24fr\)[\s\S]*?122px/,
    );
    expect(styles).toMatch(
      /@media \(min-width: 1101px\)[\s\S]*?\.cashier-ticket-table \.ds-table \{[\s\S]*?min-width: 600px;/,
    );
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
    expect(cashierSource).toContain("function QrScanDialog");
    expect(cashierSource).toContain("dialog.showModal()");
    expect(cashierSource).toContain("QR-Code vergrößern");
    expect(cashierSource).toContain("width: 768");
    expect(styles).toMatch(/\.cashier-ticket-paper \{[\s\S]*?overflow: hidden;/);
    expect(styles).toContain(".ticket-paper-preview");
    expect(styles).toContain(".qr-scan-dialog::backdrop");
    expect(styles).toMatch(/\.ticket-paper-preview \{[\s\S]*?width: 176px;/);
    expect(styles).toMatch(/\.cashier-ticket-enlarge \{[\s\S]*?width: 40px;/);
  });

  it("uses visible selection state instead of informational selection toasts", () => {
    expect(cashierSource).not.toContain("Tickets ausgewählt.");
    expect(cashierSource).not.toContain("Ticketzettel stehen zum Nachdruck bereit.");
    expect(cashierSource).toContain("selectedRowKey");
    expect(cashierSource).toContain('title="QR-Code vergrößern"');
  });
});
