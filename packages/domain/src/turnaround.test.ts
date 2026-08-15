import { describe, expect, it } from "vitest";
import { resolveTurnaroundProfile } from "./turnaround";

const event = {
  sourceId: "event-1",
  boardingMinutes: 8,
  deboardingMinutes: 5,
  bufferMinutes: 3,
};

describe("turnaround profile resolution", () => {
  it("uses unchanged event defaults without overrides", () => {
    expect(resolveTurnaroundProfile({ event })).toEqual({
      boarding: { valueMinutes: 8, sourceLevel: "EVENT", sourceId: "event-1" },
      deboarding: { valueMinutes: 5, sourceLevel: "EVENT", sourceId: "event-1" },
      buffer: { valueMinutes: 3, sourceLevel: "EVENT", sourceId: "event-1" },
      totalGroundMinutes: 16,
    });
  });

  it("resolves every phase independently across all three levels", () => {
    expect(
      resolveTurnaroundProfile({
        event,
        product: {
          sourceId: "product-1",
          boardingMinutes: 10,
          deboardingMinutes: null,
          bufferMinutes: 4,
        },
        aircraftProduct: {
          sourceId: "aircraft-1:product-1",
          boardingMinutes: null,
          deboardingMinutes: 7,
          bufferMinutes: 0,
        },
      }),
    ).toEqual({
      boarding: { valueMinutes: 10, sourceLevel: "PRODUCT", sourceId: "product-1" },
      deboarding: {
        valueMinutes: 7,
        sourceLevel: "AIRCRAFT_PRODUCT",
        sourceId: "aircraft-1:product-1",
      },
      buffer: {
        valueMinutes: 0,
        sourceLevel: "AIRCRAFT_PRODUCT",
        sourceId: "aircraft-1:product-1",
      },
      totalGroundMinutes: 17,
    });
  });

  it("uses zero for omitted event values and falls back to the event source identifier", () => {
    expect(
      resolveTurnaroundProfile({
        event: {
          sourceId: "event-fallback",
          boardingMinutes: null,
          deboardingMinutes: null,
          bufferMinutes: null,
        },
        product: {
          boardingMinutes: 2,
          deboardingMinutes: null,
          bufferMinutes: null,
        } as never,
        aircraftProduct: {
          boardingMinutes: null,
          deboardingMinutes: 3,
          bufferMinutes: null,
        } as never,
      }),
    ).toEqual({
      boarding: { valueMinutes: 2, sourceLevel: "PRODUCT", sourceId: "event-fallback" },
      deboarding: {
        valueMinutes: 3,
        sourceLevel: "AIRCRAFT_PRODUCT",
        sourceId: "event-fallback",
      },
      buffer: { valueMinutes: 0, sourceLevel: "EVENT", sourceId: "event-fallback" },
      totalGroundMinutes: 5,
    });
  });
});
