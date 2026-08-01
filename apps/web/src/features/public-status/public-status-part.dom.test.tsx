// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PublicStatusPart } from "./PublicStatusContent";

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: TestResizeObserver,
  });
});

afterEach(() => cleanup());

const part = {
  status: "WAITING" as const,
  message: "Bitte prüfen Sie den Status regelmäßig.",
  gateLabel: "Flight Line 1",
  boardingWindowLowerAt: "2026-07-31T12:20:00.000Z",
  boardingWindowUpperAt: "2026-07-31T12:40:00.000Z",
  predictionQuality: "STABLE" as const,
};

describe("V18-GRP-010 public booking group part header", () => {
  it("renders the canonical header for the second part in the shared status component", () => {
    render(
      <PublicStatusPart
        bookingGroupPart={{ partNumber: 2, partCount: 2, passengerCount: 2 }}
        part={part}
        timeZone="Europe/Berlin"
      />,
    );

    expect(screen.getByText("Teilflug 2 von 2")).toBeTruthy();
    expect(screen.getByText("2 Personen")).toBeTruthy();
  });

  it("keeps the part header hidden for a booking group with one rotation", () => {
    render(
      <PublicStatusPart
        bookingGroupPart={{ partNumber: 1, partCount: 1, passengerCount: 5 }}
        part={part}
        timeZone="Europe/Berlin"
      />,
    );

    expect(screen.queryByText(/Teilflug/)).toBeNull();
    expect(screen.queryByText("5 Personen")).toBeNull();
  });
});
