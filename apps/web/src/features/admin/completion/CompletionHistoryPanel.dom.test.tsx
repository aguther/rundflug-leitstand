// @vitest-environment jsdom

import type {
  AuditHistory,
  ForecastHistory,
  OperationalHistory,
  OperationBoard,
} from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AdminHistoryFilters, CompletionHistoryPanel } from "./CompletionHistoryPanel";

vi.mock("../../../localized-date-input", () => ({
  LocalizedDateTimeInput: ({
    label,
    onChange,
    value,
  }: {
    label: string;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <label>
      {label}
      <input aria-label={label} onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  ),
}));

vi.mock("../../../operation-workspace", () => ({
  FieldGroupLabel: ({ label }: { label: string }) => <span>{label}</span>,
  FieldLabel: ({ htmlFor, label }: { htmlFor: string; label: string }) => (
    <label htmlFor={htmlFor}>{label}</label>
  ),
}));

const board = {
  aircraft: [
    { id: "aircraft-1", registration: "D-ZULU" },
    { id: "aircraft-2", registration: "D-ALFA" },
  ],
  event: { timeZone: "Europe/Berlin" },
  pilots: [{ id: "pilot-1", operationalCode: "PILOT-01" }],
  products: [
    { code: "ZZ", id: "product-z", name: "Zeppelin" },
    { code: "AA", id: "product-a", name: "Alpenflug" },
  ],
  resourceGroups: [{ id: "resource-1", name: "Gruppe 1" }],
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

const operationalHistory = {
  entries: [
    {
      aircraftRegistration: "D-TEST",
      communicationLabel: "F-PN-0001",
      latestAt: "2026-08-13T09:10:00.000Z",
      pilotOperationalCode: "PILOT-01",
      rotationId: "rotation-1",
      ticketGroupId: "ticket-group-1",
      ticketId: "ticket-1",
      ticketStatus: "COMPLETED",
    },
    {
      aircraftRegistration: null,
      communicationLabel: null,
      latestAt: "2026-08-13T09:20:00.000Z",
      pilotOperationalCode: null,
      rotationId: null,
      ticketGroupId: "ticket-group-2",
      ticketId: "ticket-2",
      ticketStatus: "SYNTHETIC_STATUS",
    },
  ],
  total: 75,
} as unknown as OperationalHistory;

const forecastHistory = {
  entries: [
    {
      capturedAt: "2026-08-13T09:15:00.000Z",
      communicationLabel: "F-PN-0001",
      dataAgeMinutes: 3.6,
      dataBasisScope: "EVENT",
      deviationMinutes: { boarding: 2, completion: null, departure: -1, landing: 4 },
      quality: "STABLE",
      rotationId: "rotation-1",
      sampleSize: 12,
      snapshotId: "snapshot-1",
      triggerEventType: "ROTATION_CALLED",
    },
    {
      capturedAt: "2026-08-13T09:16:00.000Z",
      communicationLabel: "F-PN-0002",
      dataAgeMinutes: 1,
      dataBasisScope: "RESOURCE_GROUP",
      deviationMinutes: {},
      quality: "UNCERTAIN",
      rotationId: "rotation-2",
      sampleSize: 2,
      snapshotId: "snapshot-2",
      triggerEventType: "SYNTHETIC_EVENT",
    },
  ],
  total: 51,
} as unknown as ForecastHistory;

const auditHistory = {
  entries: [
    {
      aggregateId: "rotation-1",
      aggregateType: "ROTATION",
      aggregateVersion: 4,
      eventType: "ROTATION_CALLED",
      occurredAt: "2026-08-13T09:15:00.000Z",
      sequence: 1,
    },
    {
      aggregateId: "resource-1",
      aggregateType: "RESOURCE_GROUP",
      aggregateVersion: 2,
      eventType: "SYNTHETIC_EVENT",
      occurredAt: "2026-08-13T09:20:00.000Z",
      sequence: 2,
    },
  ],
  total: 2,
} as unknown as AuditHistory;

const emptyAuditHistory = { entries: [], total: 0 } as unknown as AuditHistory;
const emptyForecastHistory = { entries: [], total: 0 } as unknown as ForecastHistory;
const emptyOperationalHistory = { entries: [], total: 0 } as unknown as OperationalHistory;

function renderPanel(
  view: "AUDIT" | "FORECASTS" | "OPERATIONS",
  options: {
    audit?: AuditHistory;
    busyActionKey?: string | null;
    filters?: AdminHistoryFilters;
    forecast?: ForecastHistory;
    offset?: number;
    operational?: OperationalHistory;
  } = {},
) {
  const handlers = {
    apply: vi.fn(),
    change: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    reset: vi.fn(),
  };
  render(
    <CompletionHistoryPanel
      auditHistory={options.audit ?? auditHistory}
      board={board}
      busyActionKey={options.busyActionKey ?? null}
      filters={options.filters ?? emptyFilters}
      forecastHistory={options.forecast ?? forecastHistory}
      offset={options.offset ?? 0}
      onApplyFilters={handlers.apply}
      onFilterChange={handlers.change}
      onNextPage={handlers.next}
      onPreviousPage={handlers.previous}
      onResetFilters={handlers.reset}
      operationalHistory={options.operational ?? operationalHistory}
      view={view}
    />,
  );
  return handlers;
}

describe("completion history panel", () => {
  afterEach(() => cleanup());

  it("filters and pages readable operational history", async () => {
    const user = userEvent.setup();
    const filters = {
      ...emptyFilters,
      aircraftId: "aircraft-1",
      communicationNumber: "1",
      pilotId: "pilot-1",
      since: "2026-08-13T08:00",
      until: "2026-08-13T10:00",
    };
    const handlers = renderPanel("OPERATIONS", { filters, offset: 50 });

    expect(screen.getByRole("group", { name: "Betriebsdaten filtern" })).toBeTruthy();
    expect(screen.getAllByText("Abgeschlossen")).toHaveLength(2);
    expect(screen.getByText("SYNTHETIC_STATUS")).toBeTruthy();
    expect(screen.getByText("Noch offen")).toBeTruthy();
    expect(screen.getByText("51–75 von 75")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Von"), { target: { value: "2026-08-13T07:00" } });
    fireEvent.change(screen.getByLabelText("Bis"), { target: { value: "2026-08-13T11:00" } });
    fireEvent.change(screen.getByLabelText("Fluggruppennummer"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Flugzeug"), { target: { value: "aircraft-2" } });
    fireEvent.change(screen.getByLabelText("Pilotencode"), { target: { value: "pilot-1" } });
    fireEvent.change(screen.getByLabelText("Produkt"), { target: { value: "product-a" } });
    fireEvent.change(screen.getByLabelText("Ressourcengruppe"), {
      target: { value: "resource-1" },
    });
    fireEvent.change(screen.getByLabelText("Ticketstatus"), { target: { value: "NO_SHOW" } });
    const technicalInputs = screen.getAllByRole("textbox");
    fireEvent.change(technicalInputs.at(-3) as HTMLInputElement, {
      target: { value: "rotation-1" },
    });
    fireEvent.change(technicalInputs.at(-2) as HTMLInputElement, { target: { value: "ticket-1" } });
    fireEvent.change(technicalInputs.at(-1) as HTMLInputElement, {
      target: { value: "ticket-group-1" },
    });

    for (const chip of [
      "Von entfernen",
      "Bis entfernen",
      "Fluggruppe entfernen",
      "Flugzeug entfernen",
      "Pilotencode entfernen",
    ]) {
      await user.click(screen.getByRole("button", { name: chip }));
    }
    await user.click(screen.getByRole("button", { name: "Anwenden" }));
    await user.click(screen.getByRole("button", { name: "Zurücksetzen" }));
    await user.click(screen.getByRole("button", { name: "Zurück" }));

    expect(handlers.change).toHaveBeenCalledWith("productId", "product-a");
    expect(handlers.change).toHaveBeenCalledWith("ticketGroupId", "ticket-group-1");
    expect(handlers.change).toHaveBeenCalledWith("since", "", true);
    expect(handlers.apply).toHaveBeenCalledOnce();
    expect(handlers.reset).toHaveBeenCalledOnce();
    expect(handlers.previous).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Weiter" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("renders forecast filters, deviations, pagination, and empty results", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel("FORECASTS");

    expect(screen.getByRole("group", { name: "Prognosen filtern" })).toBeTruthy();
    expect(screen.getByText("Fluggruppe aufgerufen")).toBeTruthy();
    expect(screen.getByText("SYNTHETIC_EVENT")).toBeTruthy();
    expect(screen.getByText(/Boarding 2/)).toBeTruthy();
    expect(screen.getAllByText(/Abschluss –/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Flugzeug"), { target: { value: "aircraft-1" } });
    fireEvent.change(screen.getByLabelText("Pilotencode"), { target: { value: "pilot-1" } });
    fireEvent.change(screen.getAllByRole("textbox").at(-1) as HTMLInputElement, {
      target: { value: "rotation-1" },
    });
    await user.click(screen.getByRole("button", { name: "Weiter" }));
    expect(handlers.next).toHaveBeenCalledOnce();

    cleanup();
    renderPanel("FORECASTS", { busyActionKey: "history-next", forecast: emptyForecastHistory });
    expect(screen.getByText("Keine passenden Prognosesnapshots.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Weiter wird ausgeführt" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("searches audit labels and exposes technical filters without pagination", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel("AUDIT", {
      filters: { ...emptyFilters, textSearch: "fluggruppe aufgerufen" },
    });

    expect(screen.getByRole("group", { name: "Audit-Ereignisse filtern" })).toBeTruthy();
    expect(screen.getByText("Fluggruppe aufgerufen")).toBeTruthy();
    expect(screen.queryByText("SYNTHETIC_EVENT")).toBeNull();
    expect(screen.getByText("ROTATION_CALLED")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Ereignis oder Objekt suchen"), {
      target: { value: "rotation" },
    });
    const technicalInputs = screen.getAllByRole("textbox");
    fireEvent.change(technicalInputs.at(-3) as HTMLInputElement, {
      target: { value: "ROTATION_CALLED" },
    });
    fireEvent.change(technicalInputs.at(-2) as HTMLInputElement, {
      target: { value: "ROTATION" },
    });
    fireEvent.change(technicalInputs.at(-1) as HTMLInputElement, {
      target: { value: "rotation-1" },
    });
    await user.click(screen.getByRole("button", { name: "Suche entfernen" }));
    expect(handlers.change).toHaveBeenCalledWith("textSearch", "", true);

    cleanup();
    renderPanel("AUDIT", { audit: emptyAuditHistory });
    expect(screen.getByText("Keine passenden Ereignisse.")).toBeTruthy();
  });

  it("renders an empty operational result and disables pagination while busy", () => {
    renderPanel("OPERATIONS", {
      busyActionKey: "history-previous",
      operational: emptyOperationalHistory,
    });
    expect(screen.getByText("Keine passenden Betriebsdaten.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Zurück wird ausgeführt" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Weiter" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("keeps visible filters, disclosures, and actions in DOM keyboard order", () => {
    renderPanel("OPERATIONS");

    expect(document.querySelectorAll(".history-filter-disclosures")).toHaveLength(1);
    const orderedControls = [
      screen.getByLabelText("Von"),
      screen.getByLabelText("Bis"),
      screen.getByLabelText("Fluggruppennummer"),
      screen.getByText("Fachliche Filter"),
      screen.getByLabelText("Flugzeug"),
      screen.getByLabelText("Pilotencode"),
      screen.getByLabelText("Produkt"),
      screen.getByLabelText("Ressourcengruppe"),
      screen.getByLabelText("Ticketstatus"),
      screen.getByText("Technische Filter"),
      screen.getByRole("button", { name: "Anwenden" }),
      screen.getByRole("button", { name: "Zurücksetzen" }),
    ];

    for (let index = 0; index < orderedControls.length - 1; index += 1) {
      const currentControl = orderedControls[index];
      const nextControl = orderedControls[index + 1];
      if (!currentControl || !nextControl) throw new Error("Incomplete keyboard order fixture.");
      expect(
        currentControl.compareDocumentPosition(nextControl) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
    }
  });
});
