// @vitest-environment jsdom

import type { AuditHistory, OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AdminHistoryFilters, CompletionHistoryPanel } from "./CompletionHistoryPanel";

const board = {
  event: { timeZone: "Europe/Berlin" },
  aircraft: [{ id: "aircraft-a", registration: "D-SYN1" }],
  pilots: [{ id: "pilot-a", operationalCode: "P-SYN1" }],
  products: [
    { id: "product-z", code: "Z", name: "Zebra flight" },
    { id: "product-a", code: "A", name: "Alpha flight" },
  ],
  resourceGroups: [{ id: "group-a", name: "Synthetic group" }],
} as unknown as OperationBoard;

const emptyFilters: AdminHistoryFilters = {
  aggregateId: "",
  aggregateType: "",
  aircraftId: "",
  communicationNumber: "",
  eventType: "",
  pilotId: "",
  productId: "",
  resourceGroupId: "",
  rotationId: "",
  since: "",
  textSearch: "",
  ticketGroupId: "",
  ticketId: "",
  ticketStatus: "",
  until: "",
};

const auditHistory: AuditHistory = {
  entries: [
    {
      sequence: 1,
      eventType: "ROTATION_CALLED",
      occurredAt: "2026-07-31T10:00:00.000Z",
      deviceId: "synthetic-device",
      aggregateType: "ROTATION",
      aggregateId: "rotation-a",
      aggregateVersion: 2,
      payload: {},
    },
  ],
};

const baseProps = {
  auditHistory: { entries: [] },
  board,
  busyActionKey: null,
  filters: emptyFilters,
  forecastHistory: { entries: [], total: 0, limit: 50, offset: 0 },
  offset: 0,
  onApplyFilters: vi.fn(),
  onFilterChange: vi.fn(),
  onNextPage: vi.fn(),
  onPreviousPage: vi.fn(),
  onResetFilters: vi.fn(),
  operationalHistory: { entries: [], total: 60, limit: 50, offset: 0 },
  view: "OPERATIONS" as const,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("completion history panel", () => {
  it("shows operational filters, pagination and their callbacks", () => {
    const onFilterChange = vi.fn();
    const onNextPage = vi.fn();
    render(
      <CompletionHistoryPanel
        {...baseProps}
        filters={{ ...emptyFilters, since: "2026-07-31T10:00" }}
        onFilterChange={onFilterChange}
        onNextPage={onNextPage}
      />,
    );

    expect(screen.getByText("Betriebsdaten filtern")).toBeTruthy();
    expect(screen.getByText("Keine passenden Betriebsdaten.")).toBeTruthy();
    expect(screen.getByText("1–50 von 60")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Fluggruppennummer"), { target: { value: "12" } });
    expect(onFilterChange).toHaveBeenCalledWith("communicationNumber", "12");
    const productOptions = screen
      .getByLabelText("Produkt")
      .querySelectorAll<HTMLOptionElement>("option");
    expect(Array.from(productOptions, (option) => option.textContent)).toEqual([
      "Alle",
      "Alpha flight",
      "Zebra flight",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Von entfernen" }));
    expect(onFilterChange).toHaveBeenCalledWith("since", "", true);
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    expect(onNextPage).toHaveBeenCalledOnce();
  });

  it("shows forecast-specific filters and empty state", () => {
    render(<CompletionHistoryPanel {...baseProps} view="FORECASTS" />);

    expect(screen.getByText("Prognosen filtern")).toBeTruthy();
    expect(screen.getByText("Keine passenden Prognosesnapshots.")).toBeTruthy();
    expect(screen.getByLabelText("Flugzeug")).toBeTruthy();
    expect(screen.queryByLabelText("Fluggruppennummer")).toBeNull();
  });

  it("renders readable audit events while preserving technical details", () => {
    render(
      <CompletionHistoryPanel
        {...baseProps}
        auditHistory={auditHistory}
        filters={{ ...emptyFilters, textSearch: "aufgerufen" }}
        view="AUDIT"
      />,
    );

    expect(screen.getByText("Audit-Ereignisse filtern")).toBeTruthy();
    expect(screen.getByText("Fluggruppe aufgerufen")).toBeTruthy();
    expect(screen.getByText("ROTATION_CALLED")).toBeTruthy();
    expect(screen.getByText("rotation-a")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
  });
});
