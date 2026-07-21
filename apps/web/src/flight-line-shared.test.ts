import { describe, expect, it } from "vitest";
import {
  aircraftStatusLabel,
  type FlightLineAircraft,
  type FlightLineRotation,
  flightLineGroupLabel,
  flightLineStatusTone,
  latestRotationForAircraft,
  primaryAircraftActionLabel,
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
