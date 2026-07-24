import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import cashier from "./cashier-view.tsx?raw";
import publicStatusContent from "./features/public-status/PublicStatusContent.tsx?raw";
import flightLine from "./flight-line-supervisor.tsx?raw";
import groupStatus from "./group-status-view.tsx?raw";

const button = readFileSync(
  new URL("./design-system/components/Button.tsx", import.meta.url),
  "utf8",
);
const buttonStyles = readFileSync(
  new URL("./design-system/components.css", import.meta.url),
  "utf8",
);

describe("V1.8 approved UI deltas", () => {
  it("keeps busy content width stable and limits the indicator to the initiating button", () => {
    expect(button).toContain("busy?: boolean");
    expect(button).toContain("disabled={disabled || effectiveBusy}");
    expect(button).toContain("Promise.resolve(result).then");
    expect(buttonStyles).toContain(".ds-button-content--hidden");
    expect(buttonStyles).toContain("visibility: hidden");
    expect(buttonStyles).toContain('[aria-busy="true"]');
    expect(buttonStyles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("uses the reduced cashier list and one group print document", () => {
    const listStart = cashier.indexOf('className="cashier-ticket-table"');
    const listEnd = cashier.indexOf("emptyLabel=", listStart);
    const list = cashier.slice(listStart, listEnd);
    expect(list).not.toContain('key: "flight-group"');
    expect(list).not.toContain('key: "status"');
    expect(cashier).toContain('title="GoToGate-Aktiv"');
    expect(cashier).toContain('rotation.status === "DRAFT" && rotation.precalledAt');
    expect(cashier).toContain("Ticket drucken");
    expect(cashier).not.toContain("Ticketzettel erneut drucken");
    expect(cashier).toContain("publicGroupCode: groupCode");
  });

  it("keeps the exact Flight Line column order and semantics", () => {
    const expected = [
      'label: "Ticketgruppe", Icon: Tickets',
      'label: "Fluggruppe", Icon: Tag',
      'label: "Queue", Icon: ListOrdered',
      'label: "Personen", Icon: Users',
      'label: "Umlaufstatus", Icon: Activity',
      'label: "Flugzeug", Icon: Plane',
      'label: "Produkt", Icon: Package',
      'label: "GoToGate-Aktiv", Icon: CircleArrowRight',
      'label: "Zeitfenster", Icon: Clock3',
      'label: "Boarding", Icon: TicketsPlane',
      'label: "Off-Block", Icon: PlaneTakeoff',
      'label: "On-Block", Icon: PlaneLanding',
      'label: "Abschluss", Icon: CircleCheck',
    ];
    let position = flightLine.indexOf("const ticketColumns");
    for (const column of expected) {
      const next = flightLine.indexOf(column, position);
      expect(next, column).toBeGreaterThan(position);
      position = next;
    }
    expect(flightLine).toContain("phaseIcon(rotation)");
    expect(flightLine).toContain("formatAbsoluteTimeWindow");
  });

  it("shows split parts without an internal F identifier", () => {
    expect(publicStatusContent).toContain("Teilflug {partNumber} von {partCount}");
    expect(groupStatus).toContain("part.passengerCount");
    expect(publicStatusContent).toContain("part.gateLabel");
    expect(groupStatus).not.toContain("communicationLabel");
  });
});
