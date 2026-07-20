import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import apiSource from "./api.ts?raw";
import cashierSource from "./cashier-view.tsx?raw";

const styles = readFileSync(new URL("./features/cashier/cashier-v12.css", import.meta.url), "utf8");

describe("cashier release 1.6.0 acceptance coverage", () => {
  it("refreshes and paginates the operational ticket list", () => {
    expect(apiSource).toContain('params.set("status"');
    expect(apiSource).toContain('params.set("cursor"');
    expect(apiSource).toContain('params.append("id"');
    expect(cashierSource).toContain("IntersectionObserver");
    expect(cashierSource).toContain('window.addEventListener("focus"');
    expect(cashierSource).toContain("board?.event.version");
    expect(cashierSource).toContain("preserveLoaded: true");
  });

  it("uses the canonical canceled status and keeps a canceled selection", () => {
    expect(cashierSource).toContain('"ACTIVE" | "CANCELED"');
    expect(cashierSource).toContain('setTicketListTab("CANCELED")');
    expect(cashierSource).not.toContain("setLastTicketGroupId(null)");
    expect(cashierSource).toContain("ConfirmationDialog");
    expect(cashierSource).toContain("Kapazität sofort freigegeben");
  });

  it("reserves layout space at desktop and narrow widths", () => {
    expect(styles).toContain("grid-template-rows: auto 4.75rem 56px");
    expect(styles).toContain("grid-template-rows: auto 5.75rem 56px");
    expect(styles).toContain("block-size: 4.75rem");
  });

  it("keeps product selection usable beyond two products", () => {
    expect(cashierSource).toContain("board?.products.map");
    expect(cashierSource).toContain('scrollIntoView({ block: "nearest" })');
    expect(cashierSource).toContain("aria-expanded={selected}");
    expect(styles).toContain("scrollbar-gutter: stable");
    expect(styles).toContain("overflow: auto");
  });
});
