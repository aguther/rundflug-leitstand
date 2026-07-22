import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  aircraftStatusLabel,
  CompactCurrentRotation,
  type FlightLineAircraft,
  type FlightLineRotation,
  FlightProgress,
  flightLineGroupLabel,
  flightLineStatusTone,
  flightProgressIconForStep,
  flightProgressSteps,
  latestRotationForAircraft,
  primaryAircraftActionLabel,
  primaryAircraftActionPresentation,
  rotationHistoryForAircraft,
  visibleAircraftState,
} from "./flight-line-shared";

const aircraft = {
  id: "aircraft-a",
  operationalState: "AVAILABLE",
} as FlightLineAircraft;

function rotation(id: string, status: FlightLineRotation["status"]): FlightLineRotation {
  return { id, aircraftId: "aircraft-a", status } as FlightLineRotation;
}

describe("gemeinsame Flight-Line-Präsentationslogik", () => {
  it("derives German status and semantic tones from aircraft and active rotation", () => {
    const boarding = rotation("rotation-active", "CALLED");
    expect(visibleAircraftState(aircraft, boarding)).toBe("BOARDING");
    expect(aircraftStatusLabel(aircraft, boarding)).toBe("Boarding");
    expect(flightLineStatusTone("BOARDING")).toBe("warning");
    expect(flightLineStatusTone("INACTIVE")).toBe("danger");
  });

  it("maps every Assist primary state without exposing technical values", () => {
    expect(
      primaryAircraftActionLabel(aircraft, rotation("draft", "DRAFT"), "Boarding starten"),
    ).toBe("Boarding starten");
    expect(primaryAircraftActionLabel(aircraft, rotation("called", "CALLED"))).toBe("Offblock");
    expect(primaryAircraftActionLabel(aircraft, rotation("flight", "IN_FLIGHT"))).toBe("Onblock");
    expect(primaryAircraftActionLabel(aircraft, rotation("landed", "LANDED"))).toBe(
      "Umlauf abschließen",
    );
    expect(
      primaryAircraftActionLabel({ ...aircraft, operationalState: "INACTIVE" }, undefined),
    ).toBe("Verfügbar setzen");
    expect(
      primaryAircraftActionPresentation(aircraft, rotation("called", "CALLED")).shortLabel,
    ).toBe("Off-Block");
  });

  it("uses independent availability endpoints around the three connected actual stations", () => {
    const completed = {
      ...rotation("completed", "COMPLETED"),
      timeline: {
        actual: {
          boardingAt: "2026-07-21T08:00:00.000Z",
          departureAt: "2026-07-21T08:05:00.000Z",
          landingAt: "2026-07-21T08:25:00.000Z",
          completionAt: "2026-07-21T08:30:00.000Z",
        },
      },
    } as FlightLineRotation;
    const available = flightProgressSteps(
      { ...aircraft, operationalStateChangedAt: "2026-07-21T08:30:00.000Z" },
      completed,
    );
    expect(available.map((step) => step.key)).toEqual([
      "available",
      "boarding",
      "offblock",
      "onblock",
      "unavailable",
    ]);
    expect(available.find((step) => step.key === "available")?.current).toBe(true);
    expect(available.find((step) => step.key === "available")?.connectorReached).toBe(false);
    expect(available.find((step) => step.key === "onblock")?.connectorReached).toBe(false);
    expect(available.find((step) => step.key === "unavailable")?.reached).toBe(false);

    const paused = flightProgressSteps(
      {
        ...aircraft,
        operationalState: "PAUSED",
        operationalStateChangedAt: "2026-07-21T08:31:00.000Z",
      },
      completed,
    );
    expect(paused.find((step) => step.key === "unavailable")?.current).toBe(true);
    expect(paused.find((step) => step.key === "unavailable")?.icon).toBe("coffee");
    expect(paused.find((step) => step.key === "unavailable")?.label).toBe("Pause");
    expect(paused.find((step) => step.key === "available")?.current).toBe(false);
  });

  it("maps the shared timeline icons including the operational unavailable reason", () => {
    expect(flightProgressIconForStep("available", "AVAILABLE")).toBe("circle-check");
    expect(flightProgressIconForStep("boarding", "BOARDING")).toBe("tickets-plane");
    expect(flightProgressIconForStep("offblock", "IN_FLIGHT")).toBe("plane-takeoff");
    expect(flightProgressIconForStep("onblock", "LANDED")).toBe("plane-landing");
    expect(flightProgressIconForStep("unavailable", "REFUELING")).toBe("fuel");
    expect(flightProgressIconForStep("unavailable", "PAUSED")).toBe("coffee");
    expect(flightProgressIconForStep("unavailable", "INACTIVE")).toBe("circle-x");
  });

  it("renders icon-only timeline stations and keeps missing time slots visibly empty", () => {
    const markup = renderToStaticMarkup(
      createElement(FlightProgress, {
        aircraft,
        rotation: undefined,
        timeZone: "Europe/Berlin",
        variant: "detailed",
      }),
    );

    expect(markup).toContain('data-icon="circle-check"');
    expect(markup).toContain('data-icon="tickets-plane"');
    expect(markup).toContain('data-icon="plane-takeoff"');
    expect(markup).toContain('data-icon="plane-landing"');
    expect(markup).toContain('data-icon="circle-x"');
    expect(markup.match(/<small><\/small>/g)).toHaveLength(5);
    expect(markup).not.toContain("flight-director-progress-label");
  });

  it("keeps the regular current-rotation layout when no rotation exists yet", () => {
    const markup = renderToStaticMarkup(
      createElement(CompactCurrentRotation, {
        aircraft: {
          ...aircraft,
          operationalStateChangedAt: "2026-07-21T08:00:00.000Z",
        },
        rotation: undefined,
        timeZone: "Europe/Berlin",
      }),
    );

    expect(markup).toContain('class="flight-director-current-rotation is-booking-groups-only"');
    expect(markup.match(/<dd><\/dd>/g)).toHaveLength(1);
    expect(markup).toContain("Buchungsgruppen");
    expect(markup).not.toContain("<dt>Status</dt>");
    expect(markup).not.toContain("<dt>Pilot</dt>");
    expect(markup).toContain('aria-label="Umlaufzeitlinie"');
    expect(markup).toContain("10:00");
    expect(markup).toContain('aria-current="step"');
    expect(markup).not.toContain("noch kein Umlauf belegt");
  });

  it("renders up to six booking groups in the stable Assist summary", () => {
    const currentRotation = {
      ...rotation("rotation-active", "IN_FLIGHT"),
      productCode: "RN",
      communicationLabel: "RN-001",
      timeline: { actual: {} },
      bookingGroups: Array.from({ length: 6 }, (_, index) => ({
        communicationNumber: index + 1,
      })),
    } as FlightLineRotation;
    const markup = renderToStaticMarkup(
      createElement(CompactCurrentRotation, {
        aircraft,
        rotation: currentRotation,
        timeZone: "Europe/Berlin",
      }),
    );

    expect(markup).toContain("RN-001, RN-002, RN-003, RN-004, RN-005, RN-006");
    expect(markup).not.toContain("<dt>Status</dt>");
    expect(markup).not.toContain("<dt>Pilot</dt>");
  });

  it("selects the active or latest completed rotation and keeps one history item per rotation", () => {
    const first = rotation("completed-1", "COMPLETED");
    const second = rotation("completed-2", "COMPLETED");
    expect(latestRotationForAircraft(aircraft.id, [first, second])).toBe(second);
    expect(rotationHistoryForAircraft(aircraft.id, [first, second])).toEqual([second, first]);
    const active = rotation("active", "IN_FLIGHT");
    expect(latestRotationForAircraft(aircraft.id, [first, active, second])).toBe(active);
  });

  it("formats stable anonymous group labels", () => {
    expect(flightLineGroupLabel("RN", 7)).toBe("RN-007");
  });
});
