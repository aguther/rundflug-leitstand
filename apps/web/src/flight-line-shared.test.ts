import { describe, expect, it } from "vitest";
import {
  aircraftStatusLabel,
  type FlightLineAircraft,
  type FlightLineRotation,
  flightLineGroupLabel,
  flightLineStatusTone,
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

  it("uses four connected actual stations and one independent unavailable endpoint", () => {
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
      "boarding",
      "offblock",
      "onblock",
      "available",
      "unavailable",
    ]);
    expect(available.find((step) => step.key === "available")?.current).toBe(true);
    expect(available.find((step) => step.key === "available")?.connectorReached).toBe(false);
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
    expect(paused.find((step) => step.key === "available")?.current).toBe(false);
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
