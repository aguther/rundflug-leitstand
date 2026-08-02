import { beforeEach, describe, expect, it } from "vitest";
import {
  browserVersion,
  clearAnalysisUiEventsForTest,
  recentAnalysisUiEvents,
  recordAnalysisUiEvent,
} from "./analysis-client-diagnostics";

describe("in-memory analysis client diagnostics", () => {
  beforeEach(() => clearAnalysisUiEventsForTest());

  it("starts empty and retains only the newest one hundred allowlisted events", () => {
    expect(recentAnalysisUiEvents()).toEqual([]);
    for (let index = 0; index < 105; index += 1) {
      recordAnalysisUiEvent({
        type: "AIRCRAFT_SELECTED",
        occurredAt: new Date(Date.UTC(2026, 7, 2, 10, 0, index)).toISOString(),
        aircraftId: `aircraft-${index}`,
      });
    }
    const events = recentAnalysisUiEvents();
    expect(events).toHaveLength(100);
    expect(events[0]).toMatchObject({ aircraftId: "aircraft-5" });
    expect(events.at(-1)).toMatchObject({ aircraftId: "aircraft-104" });
  });

  it("derives a bounded browser family without retaining the full user agent", () => {
    expect(browserVersion("Mozilla/5.0 Edg/140.0.0.0")).toEqual({
      family: "EDGE",
      majorVersion: 140,
    });
    expect(browserVersion("synthetic-agent-without-version")).toEqual({
      family: "OTHER",
      majorVersion: null,
    });
  });
});
