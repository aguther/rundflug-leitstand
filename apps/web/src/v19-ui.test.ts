import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import cashier from "./cashier-view.tsx?raw";
import router from "./FeatureRouter.tsx?raw";

const flightLine = readFileSync(new URL("./flight-line-view.tsx", import.meta.url), "utf8");

const cashierStyles = readFileSync(
  new URL("./features/cashier/cashier-v12.css", import.meta.url),
  "utf8",
);
const legacyStyles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const cashierTicketPresentation = readFileSync(
  new URL("./features/cashier/CashierTicketPresentation.tsx", import.meta.url),
  "utf8",
);
const cashierTablePresentation = readFileSync(
  new URL("./features/cashier/CashierTablePresentation.tsx", import.meta.url),
  "utf8",
);
const cashierCompletionSource = `${cashierTicketPresentation}\n${cashierTablePresentation}`;

describe("V1.9 approved UI delta", () => {
  it("uses the approved cashier tabs and icon headers", () => {
    const soldTab = cashier.indexOf('{ value: "ACTIVE", label: "Verkaufte Tickets" }');
    const openTab = cashier.indexOf('{ value: "OPEN", label: "Offene Tickets" }');
    const canceledTab = cashier.indexOf('{ value: "CANCELED", label: "Stornierte Tickets" }');
    expect(soldTab).toBeGreaterThan(-1);
    expect(openTab).toBeGreaterThan(soldTab);
    expect(canceledTab).toBeGreaterThan(openTab);
    for (const label of [
      "Verkauf",
      "Gruppe",
      "Produkt",
      "Personen",
      "Abgeschlossen",
      "Summe",
      "Fluggruppe",
      "Status",
      "GoToGate-Aktiv",
      "Zeitfenster",
    ]) {
      expect(cashier).toContain(`label="${label}"`);
    }
    expect(cashier).toContain("<Coins");
    expect(cashier).toContain("<Flag");
    expect(cashier).toContain("<Sigma");
    expect(cashier).not.toContain("<CircleUserRound");
  });

  it("shows progress and success semantics for ticket and rotation completion", () => {
    expect(cashierCompletionSource).toContain("cashierTicketCompletionIndicator");
    expect(cashierCompletionSource).toContain("<CircleEllipsis");
    expect(cashierCompletionSource).toContain("<CircleCheck");
    expect(cashierStyles).toMatch(
      /\.cashier-phase-icon\.is-complete,[\s\S]*?color: var\(--ui-success\);/,
    );
  });

  it("splits the sale action one-third to two-thirds with centered content", () => {
    expect(cashierStyles).toMatch(
      /\.cashier-sell-action\.ds-button > \.ds-button-content \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 2fr\);/,
    );
    expect(cashierStyles).toMatch(/\.cashier-sell-copy \{[\s\S]*?place-items: center;/);
  });

  it("owns POS-58 print layout in one stylesheet without fixed roll length", () => {
    expect(cashierStyles.match(/@media print/g)).toHaveLength(1);
    expect(legacyStyles).not.toContain("@media print");
    expect(cashierStyles).toMatch(/@page \{[\s\S]*?margin: 0;/);
    expect(cashierStyles).not.toContain("size: 58mm 110mm");
    expect(cashierStyles).not.toContain("min-height: 100mm");
    expect(cashierStyles).not.toContain("break-after: page");
    expect(cashierStyles).toMatch(
      /\.cashier-shell > \.ticket-print-document \{[\s\S]*?width: 100%;[\s\S]*?justify-content: center;/,
    );
    expect(cashierStyles).toMatch(
      /\.ticket-print-document \.ticket-paper \{[\s\S]*?width: 56mm;[\s\S]*?padding: 1mm;/,
    );
    expect(cashierStyles).toMatch(
      /\.ticket-print-document \.ticket-paper > img \{[\s\S]*?width: 52mm;[\s\S]*?height: 52mm;/,
    );
  });

  it("maps only the approved Flight Director and Flight Line paths", () => {
    expect(router).toContain('path === "/flight-director" || path === "/flight-line"');
    expect(router).not.toContain('path === "/flight-line/assist"');
    expect(flightLine).toContain('window.location.pathname === "/flight-line"');
  });
});
