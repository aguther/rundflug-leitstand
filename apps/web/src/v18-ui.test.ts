import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import cashier from "./cashier-view.tsx?raw";
import publicStatusContent from "./features/public-status/PublicStatusContent.tsx?raw";
import flightLine from "./flight-line-supervisor.tsx?raw";
import flightLineView from "./flight-line-view.tsx?raw";
import groupStatus from "./group-status-view.tsx?raw";

const button = readFileSync(
  new URL("./design-system/components/Button.tsx", import.meta.url),
  "utf8",
);
const buttonStyles = readFileSync(
  new URL("./design-system/components.css", import.meta.url),
  "utf8",
);
const cashierPresentation = readFileSync(
  new URL("./features/cashier/CashierViewPresentation.tsx", import.meta.url),
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
    expect(cashier).toContain('label="GoToGate-Aktiv"');
    expect(cashierPresentation).toContain('rotation.status === "DRAFT" && rotation.precalledAt');
    expect(cashier).toContain("Ticket drucken");
    expect(cashier).not.toContain("Ticketzettel erneut drucken");
    expect(cashier).toContain("ticketCount: size");
    expect(cashier).not.toContain("publicGroupCode");
  });

  it("keeps operational busy states through projection and releases sales after persistence", () => {
    const rotationAction = flightLineView.slice(
      flightLineView.indexOf("async function advance("),
      flightLineView.indexOf("async function setGroupAttendance("),
    );
    const aircraftAction = flightLineView.slice(
      flightLineView.indexOf("async function setFlightLineAircraftState("),
      flightLineView.indexOf("function startAircraftPause("),
    );
    const ticketSale = cashier.slice(
      cashier.indexOf("async function sell("),
      cashier.indexOf("async function cancelLastSale("),
    );

    expect(rotationAction).toContain("await refresh(result.event.version)");
    expect(aircraftAction).toContain("await refresh(result.event.version)");
    expect(ticketSale).toContain("setBusyProductId(null)");
    expect(ticketSale).toContain("await Promise.allSettled([");
    expect(ticketSale).toContain("refresh(saleResult.event.version)");
    expect(ticketSale).toContain("mergeTicketGroupsById([soldTicketGroupId])");
    expect(ticketSale).toContain("loadTicketList({ preserveLoaded: true, reportError: false })");
    expect(ticketSale.indexOf("setBusyProductId(null)")).toBeLessThan(
      ticketSale.indexOf("await Promise.allSettled(["),
    );
    expect(ticketSale).toContain("receiptRequestToken === receiptRequestRef.current");
    expect(`${rotationAction}\n${aircraftAction}\n${ticketSale}`).not.toContain("void refresh(");
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
      'label: "Voraufruf", Icon: CircleArrowRight',
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
    expect(flightLine).toContain("<RotationPhaseIcon rotation={rotation} />");
    expect(flightLine).toContain("formatAbsoluteTimeWindow");
  });

  it("shows split parts without an internal F identifier", () => {
    expect(publicStatusContent).toContain("formatBookingGroupPart(bookingGroupPart)");
    expect(groupStatus).toContain("bookingGroupPart={part}");
    expect(publicStatusContent).toContain("part.gateLabel");
    expect(groupStatus).not.toContain("communicationLabel");
  });
});
