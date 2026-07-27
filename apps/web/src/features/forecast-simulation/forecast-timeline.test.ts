import { describe, expect, it } from "vitest";
import { buildTimelineInterruptions } from "./ForecastTimeline";
import type { SimulationEvent } from "./model";

function event(
  id: string,
  type: SimulationEvent["type"],
  occurredAt: string,
  aircraftId: string | null,
): SimulationEvent {
  return {
    id,
    type,
    occurredAt,
    aircraftId,
    rotationId: null,
    details: `${type} details`,
    forecastRecalculatedAt: occurredAt,
  };
}

describe("forecast timeline interruption projection", () => {
  it("shows completed and still-open aircraft interruptions without exposing a future return", () => {
    const events = [
      event("planned", "PLANNED_PAUSE_STARTED", "2026-07-24T10:00:00.000Z", "aircraft-1"),
      event("planned-end", "AIRCRAFT_RETURN_CONFIRMED", "2026-07-24T10:20:00.000Z", "aircraft-1"),
      event("unplanned", "TECHNICAL_DEFECT_REPORTED", "2026-07-24T10:30:00.000Z", "aircraft-1"),
      event("other", "UNPLANNED_PAUSE_STARTED", "2026-07-24T10:35:00.000Z", "aircraft-2"),
      event("future-end", "AIRCRAFT_RETURN_CONFIRMED", "2026-07-24T11:00:00.000Z", "aircraft-1"),
    ];

    expect(
      buildTimelineInterruptions(
        events,
        "aircraft-1",
        Date.parse("2026-07-24T10:45:00.000Z"),
        Date.parse("2026-07-24T12:00:00.000Z"),
      ),
    ).toEqual([
      expect.objectContaining({
        id: "planned",
        label: "Geplante Pause",
        tone: "planned",
        active: false,
        end: Date.parse("2026-07-24T10:20:00.000Z"),
      }),
      expect.objectContaining({
        id: "unplanned",
        label: "Defekt",
        tone: "unplanned",
        active: true,
        end: Date.parse("2026-07-24T10:45:00.000Z"),
      }),
    ]);
  });

  it("projects global interruptions onto the shared operating lane", () => {
    const events = [
      event("global-start", "EVENT_INTERRUPTED", "2026-07-24T09:00:00.000Z", null),
      event("global-end", "EVENT_RESUMED", "2026-07-24T09:30:00.000Z", null),
    ];

    expect(
      buildTimelineInterruptions(
        events,
        null,
        Date.parse("2026-07-24T10:00:00.000Z"),
        Date.parse("2026-07-24T12:00:00.000Z"),
      ),
    ).toEqual([
      expect.objectContaining({
        label: "Betrieb unterbrochen",
        active: false,
        start: Date.parse("2026-07-24T09:00:00.000Z"),
        end: Date.parse("2026-07-24T09:30:00.000Z"),
      }),
    ]);
  });
});
