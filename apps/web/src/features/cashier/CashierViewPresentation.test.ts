import type { OperationBoard } from "@rundflug/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeFlightEmptyLabel,
  cancellationDescription,
  cashierCapacityGuidance,
  goToGateIcon,
  measurePerformanceSafely,
  printableTicketDocument,
  rotationPhaseClass,
  rotationStatusLabel,
  rotationTimeWindowPhase,
  ticketListEmptyLabel,
  ticketListSentinelLabel,
  ticketMatchesListStatus,
  ticketSearchRequest,
} from "./CashierViewPresentation";

type CashierProduct = OperationBoard["products"][number];

const activeEvent = {
  emergencyMode: false,
  operationalInterrupted: false,
  saleOpensAt: null,
  status: "ACTIVE",
} as OperationBoard["event"];

function product(
  capacityStatus: CashierProduct["capacityStatus"],
  saleRecommended: boolean,
): CashierProduct {
  return {
    capacityStatus,
    resourceGroupStatus: "ACTIVE",
    saleClosesAt: null,
    saleEnabled: true,
    saleRecommended,
  } as CashierProduct;
}

function board(products: CashierProduct[], event = activeEvent): OperationBoard {
  return { event, products } as OperationBoard;
}

describe("cashier presentation behavior", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("presents the most restrictive status without turning a recommendation into a hard guard", () => {
    expect(
      cashierCapacityGuidance(board([product("AVAILABLE", true), product("MANUAL_REVIEW", false)])),
    ).toEqual({
      label: "Kapazität manuell prüfen",
      recommendation: "Verkauf derzeit nicht empfohlen · bewusster Verkauf bleibt möglich",
      tone: "warning",
    });
  });

  it("reserves stable copy while capacity is loading", () => {
    expect(cashierCapacityGuidance(null)).toEqual({
      label: "Kapazität wird geladen",
      recommendation: "Verkaufsempfehlung wird ermittelt",
      tone: "loading",
    });
  });

  it("distinguishes unavailable products and every limiting capacity status", () => {
    expect(cashierCapacityGuidance(board([product("AVAILABLE", true)]))).toEqual({
      label: "Kapazität verfügbar",
      recommendation: "Verkauf empfohlen",
      tone: "positive",
    });
    expect(cashierCapacityGuidance(board([product("LIMITED", true)]))).toMatchObject({
      label: "Kapazität begrenzt",
    });
    expect(cashierCapacityGuidance(board([product("SOLD_OUT", false)]))).toMatchObject({
      label: "Keine prognostizierte Kapazität",
      tone: "warning",
    });
    expect(
      cashierCapacityGuidance(board([{ ...product("AVAILABLE", true), saleEnabled: false }])),
    ).toEqual({
      label: "Produktverkauf gesperrt",
      recommendation: "Verkauf nicht möglich",
      tone: "warning",
    });
  });

  it("presents a closed event as a hard sale block without changing product configuration", () => {
    const configuredProduct = product("AVAILABLE", true);
    expect(
      cashierCapacityGuidance(board([configuredProduct], { ...activeEvent, status: "CLOSED" })),
    ).toEqual({
      label: "Betrieb geschlossen",
      recommendation: "Verkauf nicht möglich",
      tone: "warning",
    });
    expect(configuredProduct.saleEnabled).toBe(true);
  });

  it("filters ticket list states and reports stable empty and pagination labels", () => {
    const ticket = (groupStatus: string) => ({ groupStatus }) as never;
    expect(ticketMatchesListStatus(ticket("CANCELED"), "CANCELED")).toBe(true);
    expect(ticketMatchesListStatus(ticket("QUEUED"), "CANCELED")).toBe(false);
    expect(ticketMatchesListStatus(ticket("QUEUED"), "OPEN")).toBe(true);
    expect(ticketMatchesListStatus(ticket("COMPLETED"), "OPEN")).toBe(false);
    expect(ticketMatchesListStatus(ticket("QUEUED"), "ACTIVE")).toBe(true);
    expect(ticketMatchesListStatus(ticket("CANCELED"), "ACTIVE")).toBe(false);
    expect(ticketListEmptyLabel("CANCELED")).toBe("Keine stornierten Tickets vorhanden.");
    expect(ticketListEmptyLabel("OPEN")).toBe("Keine offenen Tickets vorhanden.");
    expect(ticketListEmptyLabel("ACTIVE")).toBe("Noch keine Tickets verkauft.");
    expect(ticketListSentinelLabel(true, "cursor-two")).toBe("Liste wird aktualisiert …");
    expect(ticketListSentinelLabel(false, "cursor-two")).toBe(
      "Weitere Buchungsgruppen werden beim Scrollen geladen.",
    );
    expect(ticketListSentinelLabel(false, null)).toBe("Listenende");
  });

  it("maps every rotation status and distinguishes current, forecast and finished phases", () => {
    expect(
      (["DRAFT", "CALLED", "IN_FLIGHT", "LANDED", "COMPLETED"] as const).map(rotationStatusLabel),
    ).toEqual(["Wartet", "Boarding", "Im Flug", "Gelandet", "Abgeschlossen"]);
    const rotation = (status: string, precalledAt: string | null = null) =>
      ({ status, precalledAt }) as OperationBoard["rotations"][number];
    expect(rotationTimeWindowPhase(rotation("CALLED"))).toBe("NOW");
    expect(rotationTimeWindowPhase(rotation("DRAFT", "2026-08-15T12:00:00.000Z"))).toBe("NOW");
    expect(rotationTimeWindowPhase(rotation("DRAFT"))).toBe("FORECAST");
    expect(rotationTimeWindowPhase(rotation("COMPLETED"))).toBe("FINISHED");
  });

  it("builds bounded ticket searches with optional pagination and cashier ownership", () => {
    expect(
      ticketSearchRequest({
        append: false,
        loadedCount: 3,
        nextCursor: null,
        preserveLoaded: false,
        query: "PN",
        status: "ACTIVE",
      }),
    ).toEqual({ limit: 20, q: "PN", status: "ACTIVE" });
    expect(
      ticketSearchRequest({
        append: true,
        loadedCount: 80,
        nextCursor: "cursor-two",
        preserveLoaded: true,
        query: "",
        soldByOperatorAccountId: "cashier-one",
        status: "OPEN",
      }),
    ).toEqual({
      cursor: "cursor-two",
      limit: 50,
      q: "",
      soldByOperatorAccountId: "cashier-one",
      status: "OPEN",
    });
    expect(
      ticketSearchRequest({
        append: true,
        loadedCount: 1,
        nextCursor: null,
        preserveLoaded: true,
        query: "",
        status: "OPEN",
      }).limit,
    ).toBe(20);
  });

  it("keeps performance instrumentation from affecting confirmed behavior", () => {
    const measure = vi.fn();
    vi.stubGlobal("performance", { measure, now: () => 20 });
    expect(() => measurePerformanceSafely("cashier-sale", 10)).not.toThrow();
    expect(measure).toHaveBeenCalledWith("cashier-sale", { end: 20, start: 10 });
    measure.mockImplementation(() => {
      throw new Error("synthetic measurement failure");
    });
    expect(() => measurePerformanceSafely("cashier-sale", 10)).not.toThrow();
  });

  it("derives action icons, phase classes and user-facing fallback copy", () => {
    const rotation = (status: string, precalledAt: string | null = null) =>
      ({ status, precalledAt }) as OperationBoard["rotations"][number];
    expect(rotationPhaseClass("COMPLETED")).toBe("cashier-phase-icon is-complete");
    expect(rotationPhaseClass("DRAFT")).toBe("cashier-phase-icon");
    expect(goToGateIcon(rotation("DRAFT", "2026-08-15T12:00:00.000Z"))).not.toBeNull();
    expect(goToGateIcon(rotation("DRAFT"))).toBeNull();
    expect(goToGateIcon(rotation("CALLED", "2026-08-15T12:00:00.000Z"))).toBeNull();
    expect(activeFlightEmptyLabel(undefined)).toBe("Ticketgruppe auswählen.");
    expect(activeFlightEmptyLabel({} as never)).toBe("Keine aktive Fluggruppe vorhanden.");
    expect(printableTicketDocument(null)).toBeNull();
    expect(printableTicketDocument({ communicationLabel: "G-PN-0001" } as never)).not.toBeNull();
    expect(cancellationDescription(undefined)).toBe(
      "Buchungsgruppe · 0 Tickets. Die aktive Belegung wird gelöst und die Kapazität sofort freigegeben.",
    );
    expect(cancellationDescription({ bookingGroupLabel: "BG-1", groupSize: 1 } as never)).toBe(
      "BG-1 · 1 Ticket. Die aktive Belegung wird gelöst und die Kapazität sofort freigegeben.",
    );
  });
});
