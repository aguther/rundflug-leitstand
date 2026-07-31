// @vitest-environment jsdom

import type { OperationBoard, ResourceDayHistory } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
        },
        {
          id: "ticket-group-2",
          communicationNumber: 107,
          soldAt: "2026-07-11T19:01:00.000Z",
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
      name: /Ticketgruppen G-RN-0106, G-RN-0107 · Fluggruppe F-RN-0105/,
    });
    expect(rotationButton.textContent).toBe("");
    expect(rotationButton.getAttribute("title")).toContain(
      "22:25–22:35 Uhr · 1/3 Personen · D-EDNE · P-PATRICK",
    );

    const viewport = container.querySelector(".flight-director-chart-viewport");
    expect(viewport).not.toBeNull();
    if (!(viewport instanceof HTMLDivElement)) return;
    Object.assign(viewport, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });

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
  });
});
