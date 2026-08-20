// @vitest-environment jsdom

import type { ForecastHistory, OperationBoard, ResourceDayHistory } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlightDirectorAnalyticsContent } from "./FlightDirectorAnalyticsContent";

const board = {
  event: { timeZone: "Europe/Berlin" },
  aircraft: [
    {
      id: "aircraft-1",
      registration: "D-EDNE",
      aircraftType: "C172",
      passengerSeats: 3,
    },
  ],
  pilots: [
    {
      id: "pilot-1",
      operationalCode: "P-PATRICK",
      active: true,
      paused: false,
    },
  ],
  rotations: [
    {
      id: "rotation-1",
      ticketGroupId: "ticket-group-1",
      communicationNumber: 105,
      communicationLabel: "F-RN-0105",
      productCode: "RN",
      productName: "Rundflug",
      bookingGroups: [
        {
          id: "ticket-group-1",
          communicationNumber: 106,
          soldAt: "2026-07-11T19:00:00.000Z",
          partNumber: 1,
          partCount: 2,
        },
        {
          id: "ticket-group-2",
          communicationNumber: 107,
          soldAt: "2026-07-11T19:01:00.000Z",
          partNumber: 1,
          partCount: 1,
        },
      ],
    },
  ],
} as OperationBoard;

const history = {
  scopeType: "AIRCRAFT",
  scopeId: "aircraft-1",
  from: "2026-07-11T20:00:00.000Z",
  until: "2026-07-11T21:00:00.000Z",
  observedUntil: "2026-07-11T20:35:00.000Z",
  blocks: [],
  rotations: [
    {
      rotationId: "rotation-1",
      flightGroupId: "flight-group-1",
      communicationNumber: 105,
      communicationLabel: "F-RN-0105",
      resourceGroupId: "resource-group-1",
      resourceGroupName: "Rundflug",
      productName: "Rundflug",
      passengerCount: 1,
      usableCapacity: 3,
      aircraftId: "aircraft-1",
      aircraftRegistration: "D-EDNE",
      pilotId: "pilot-1",
      pilotOperationalCode: "P-PATRICK",
      actual: {
        boardingAt: "2026-07-11T20:25:00.000Z",
        departureAt: "2026-07-11T20:27:00.000Z",
        landingAt: "2026-07-11T20:32:00.000Z",
        completionAt: "2026-07-11T20:35:00.000Z",
      },
    },
  ],
} as ResourceDayHistory;

const analyticsBoard = {
  ...board,
  rotations: board.rotations.map((rotation) => ({
    ...rotation,
    precalledAt: "2026-07-11T19:55:00.000Z",
    timeline: {
      actual: {
        boardingAt: "2026-07-11T20:25:00.000Z",
        departureAt: "2026-07-11T20:27:00.000Z",
        landingAt: "2026-07-11T20:32:00.000Z",
        completionAt: "2026-07-11T20:35:00.000Z",
      },
      predicted: {
        boardingAt: "2026-07-11T20:24:00.000Z",
        departureAt: "2026-07-11T20:29:00.000Z",
        landingAt: "2026-07-11T20:49:00.000Z",
        completionAt: "2026-07-11T20:55:00.000Z",
      },
      forecastAssumedAircraftId: "aircraft-1",
      effectiveTurnaroundProfile: {
        boarding: { valueMinutes: 5, sourceLevel: "AIRCRAFT_PRODUCT" },
        deboarding: { valueMinutes: 4, sourceLevel: "PRODUCT" },
        buffer: { valueMinutes: 2, sourceLevel: "EVENT" },
      },
      extendsBeyondOperationsEnd: true,
      overtimeMinutes: 5,
    },
  })),
} as OperationBoard;

function forecastEntry(index: number): ForecastHistory["entries"][number] {
  const capturedAt = new Date(
    Date.parse("2026-07-11T19:00:00.000Z") + index * 60_000,
  ).toISOString();
  const boardingAt = new Date(
    Date.parse("2026-07-11T20:20:00.000Z") + index * 60_000,
  ).toISOString();
  return {
    snapshotId: `snapshot-${index}`,
    capturedAt,
    quality: index % 3 === 0 ? "STABLE" : index % 3 === 1 ? "CHANGING" : "UNCERTAIN",
    sampleSize: index + 1,
    predicted: {
      boardingAt,
      departureAt: new Date(Date.parse(boardingAt) + 5 * 60_000).toISOString(),
      landingAt: new Date(Date.parse(boardingAt) + 25 * 60_000).toISOString(),
      completionAt: new Date(Date.parse(boardingAt) + 31 * 60_000).toISOString(),
    },
  } as ForecastHistory["entries"][number];
}

function renderGroupAnalytics(
  loadForecastHistory: (rotationId: string) => Promise<ForecastHistory["entries"]>,
  overrides: Partial<React.ComponentProps<typeof FlightDirectorAnalyticsContent>> = {},
) {
  return render(
    <FlightDirectorAnalyticsContent
      aircraftId="aircraft-1"
      board={analyticsBoard}
      loadForecastHistory={loadForecastHistory}
      loadResourceHistory={vi.fn(async () => history)}
      onAircraftIdChange={vi.fn()}
      onOpenRotation={vi.fn()}
      onPilotIdChange={vi.fn()}
      onRotationIdChange={vi.fn()}
      onTicketGroupIdChange={vi.fn()}
      pilotId="pilot-1"
      rotationId="rotation-1"
      tab="groups"
      ticketGroupId="ticket-group-1"
      {...overrides}
    />,
  );
}

describe("FlightDirectorAnalyticsContent resource timeline", () => {
  afterEach(() => cleanup());

  it("keeps rotation details accessible without rendering a permanent label", async () => {
    const onOpenRotation = vi.fn();
    const { container } = render(
      <FlightDirectorAnalyticsContent
        aircraftId="aircraft-1"
        board={board}
        loadForecastHistory={vi.fn(async () => [])}
        loadResourceHistory={vi.fn(async () => history)}
        onAircraftIdChange={vi.fn()}
        onOpenRotation={onOpenRotation}
        onPilotIdChange={vi.fn()}
        onRotationIdChange={vi.fn()}
        onTicketGroupIdChange={vi.fn()}
        pilotId="pilot-1"
        rotationId="rotation-1"
        tab="aircraft"
        ticketGroupId="ticket-group-1"
      />,
    );

    const rotationButton = await screen.findByRole("button", {
      name: /Ticketgruppen G-RN-0106\/1, G-RN-0107 · Fluggruppe F-RN-0105/,
    });
    expect(rotationButton.textContent).toBe("");
    expect(rotationButton.getAttribute("title")).toContain(
      "22:25–22:35 Uhr · 1/3 Personen · D-EDNE · P-PATRICK",
    );
    expect(
      Array.from(container.querySelectorAll(".flight-director-analytics-table th"))
        .slice(0, 4)
        .map((cell) => cell.textContent),
    ).toEqual(["Ticketgruppe", "Fluggruppe", "Flugzeug", "Pilot"]);
    expect(container.querySelector(".flight-director-analytics-table tbody td")?.textContent).toBe(
      "G-RN-0106/1, G-RN-0107",
    );
    const resourceTable = container.querySelector(
      ".flight-director-analytics-table.is-resource-history",
    );
    expect(resourceTable?.querySelectorAll("col")).toHaveLength(7);
    expect(resourceTable?.querySelector("col.resource-time")?.getAttribute("span")).toBe("4");
    const tableForecastButton = screen.getByRole("button", {
      name: "Prognose für F-RN-0105 öffnen",
    });
    expect(tableForecastButton.textContent).toBe("");
    expect(tableForecastButton.querySelector("svg")).not.toBeNull();

    const viewport = container.querySelector(".flight-director-chart-viewport");
    expect(viewport).not.toBeNull();
    const resourceZoomGroup = screen.getByRole("group", { name: "Diagramm-Zoom" });
    expect(resourceZoomGroup.querySelectorAll("button")).toHaveLength(3);
    expect(screen.queryByText("Gesamt")).toBeNull();
    if (!(viewport instanceof HTMLDivElement)) return;
    Object.assign(viewport, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 800 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ left: 100, right: 900, width: 800 }),
      },
    });
    fireEvent.wheel(viewport, { clientX: 500, ctrlKey: true, deltaY: -1 });

    fireEvent.pointerDown(rotationButton, {
      button: 0,
      clientX: 200,
      pointerId: 10,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(viewport, {
      clientX: 180,
      pointerId: 10,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(viewport, {
      clientX: 180,
      pointerId: 10,
      pointerType: "mouse",
    });
    fireEvent.click(rotationButton);
    expect(onOpenRotation).not.toHaveBeenCalled();

    fireEvent.click(rotationButton);
    expect(onOpenRotation).toHaveBeenCalledWith("rotation-1");

    onOpenRotation.mockClear();
    fireEvent.click(tableForecastButton);
    expect(onOpenRotation).toHaveBeenCalledWith("rotation-1");
  });

  it("shows the same ticket group projection in the pilot history table", async () => {
    const pilotHistory = {
      ...history,
      scopeId: "pilot-1",
      scopeType: "PILOT",
    } as ResourceDayHistory;
    const { container } = render(
      <FlightDirectorAnalyticsContent
        aircraftId="aircraft-1"
        board={board}
        loadForecastHistory={vi.fn(async () => [])}
        loadResourceHistory={vi.fn(async () => pilotHistory)}
        onAircraftIdChange={vi.fn()}
        onOpenRotation={vi.fn()}
        onPilotIdChange={vi.fn()}
        onRotationIdChange={vi.fn()}
        onTicketGroupIdChange={vi.fn()}
        pilotId="pilot-1"
        rotationId="rotation-1"
        tab="pilots"
        ticketGroupId="ticket-group-1"
      />,
    );

    await screen.findByRole("heading", { name: "Piloteneinsatz P-PATRICK" });
    expect(
      Array.from(container.querySelectorAll(".flight-director-analytics-table th"))
        .slice(0, 4)
        .map((cell) => cell.textContent),
    ).toEqual(["Ticketgruppe", "Fluggruppe", "Flugzeug", "Pilot"]);
    expect(container.querySelector(".flight-director-analytics-table tbody td")?.textContent).toBe(
      "G-RN-0106/1, G-RN-0107",
    );
  });

  it("shows loading, empty, and error states for forecast history", async () => {
    let resolveHistory: ((entries: ForecastHistory["entries"]) => void) | undefined;
    const pending = new Promise<ForecastHistory["entries"]>((resolve) => {
      resolveHistory = resolve;
    });
    const first = renderGroupAnalytics(vi.fn(() => pending));

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    resolveHistory?.([]);
    await screen.findByText("Für diese Fluggruppe wurden noch keine Prognose-Snapshots erfasst.");
    first.unmount();

    renderGroupAnalytics(vi.fn(async () => Promise.reject(new Error("Historie nicht erreichbar"))));
    expect((await screen.findByRole("alert")).textContent).toContain("Historie nicht erreichbar");
  });

  it("renders the native forecast chart, tooltip, references, metrics, and pagination", async () => {
    const entries = Array.from({ length: 10 }, (_, index) => forecastEntry(index));
    const { container } = renderGroupAnalytics(vi.fn(async () => entries));

    expect(await screen.findAllByText("10 Umläufe")).toHaveLength(2);
    expect(screen.getByText("+1 Min.")).not.toBeNull();
    expect(screen.getAllByText("D-EDNE").length).toBeGreaterThan(0);
    expect(screen.getByText("5 + 4 + 2 Min.")).not.toBeNull();
    expect(screen.getByText("Flugzeug + Produkt / Produkt / Veranstaltung")).not.toBeNull();
    expect(screen.getByText(/\+5 Min\./)).not.toBeNull();
    expect(screen.getByRole("img", { name: /Prognosediagramm/ })).not.toBeNull();
    const forecastZoomGroup = screen.getByRole("group", { name: "Diagramm-Zoom" });
    expect(forecastZoomGroup.querySelectorAll("button")).toHaveLength(3);
    expect(screen.queryByText("Gesamt")).toBeNull();
    expect(container.querySelectorAll(".flight-director-forecast-svg [data-series]")).toHaveLength(
      4,
    );
    expect(
      container.querySelectorAll(".flight-director-forecast-svg .svg-chart-reference.horizontal"),
    ).toHaveLength(4);
    const viewport = container.querySelector(".flight-director-chart-viewport");
    expect(viewport).toBeInstanceOf(HTMLDivElement);
    if (viewport instanceof HTMLDivElement) {
      Object.defineProperties(viewport, {
        clientWidth: { configurable: true, value: 800 },
        getBoundingClientRect: {
          configurable: true,
          value: () => ({ height: 260, left: 100, right: 900, top: 100, width: 800 }),
        },
      });
      fireEvent.pointerMove(viewport, { buttons: 0, clientX: 500, clientY: 150 });
      expect(screen.getByText(/Stand .* Uhr/)).not.toBeNull();
      expect(screen.getByText(/Boarding: .* Uhr/)).not.toBeNull();
    }
    expect(screen.getByText("Seite 1 von 2")).not.toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(9);

    fireEvent.click(screen.getByRole("button", { name: /Weiter/ }));
    expect(screen.getByText("Seite 2 von 2")).not.toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getAllByText("Stabil").length).toBeGreaterThan(0);
    expect(screen.getByText("Veränderlich")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Zurück/ }));
    expect(screen.getByText("Seite 1 von 2")).not.toBeNull();
  });

  it("forwards ticket-group and rotation selector changes", async () => {
    const onRotationIdChange = vi.fn();
    const onTicketGroupIdChange = vi.fn();
    renderGroupAnalytics(
      vi.fn(async () => []),
      {
        onRotationIdChange,
        onTicketGroupIdChange,
      },
    );
    await screen.findByText("Für diese Fluggruppe wurden noch keine Prognose-Snapshots erfasst.");

    const selectors = screen.getAllByRole("combobox");
    fireEvent.change(selectors[0] as HTMLSelectElement, { target: { value: "ticket-group-2" } });
    fireEvent.change(selectors[1] as HTMLSelectElement, { target: { value: "rotation-1" } });

    expect(onTicketGroupIdChange).toHaveBeenCalledWith("ticket-group-2");
    expect(onRotationIdChange).toHaveBeenCalledWith("rotation-1");
  });

  it("reports resource failures and reuses a successful resource cache", async () => {
    const loadResourceHistory = vi.fn().mockRejectedValueOnce("offline").mockResolvedValue(history);
    const props = {
      aircraftId: "aircraft-1",
      board: analyticsBoard,
      loadForecastHistory: vi.fn(async () => []),
      loadResourceHistory,
      onAircraftIdChange: vi.fn(),
      onOpenRotation: vi.fn(),
      onPilotIdChange: vi.fn(),
      onRotationIdChange: vi.fn(),
      onTicketGroupIdChange: vi.fn(),
      pilotId: "pilot-1",
      rotationId: "rotation-1",
      tab: "aircraft" as const,
      ticketGroupId: "ticket-group-1",
    };
    const { rerender } = render(<FlightDirectorAnalyticsContent {...props} />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Tagesverlauf nicht verfügbar.",
    );
    rerender(<FlightDirectorAnalyticsContent {...props} aircraftId="" />);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    rerender(<FlightDirectorAnalyticsContent {...props} />);
    await screen.findByRole("heading", { name: "Tagesumlauf D-EDNE" });
    expect(loadResourceHistory).toHaveBeenCalledTimes(2);

    rerender(<FlightDirectorAnalyticsContent {...props} tab="groups" />);
    rerender(<FlightDirectorAnalyticsContent {...props} />);
    await screen.findByRole("heading", { name: "Tagesumlauf D-EDNE" });
    expect(loadResourceHistory).toHaveBeenCalledTimes(2);
  });
});
