import { describe, expect, it } from "vitest";
import { resolveForecastDurationBasis } from "./forecast-duration-basis";
import { DEFAULT_FORECAST_TUNING_PROFILE } from "./forecast-types";

const NOW = "2026-07-31T12:00:00.000Z";

function sample(
  minutes: number,
  eventId: string,
  aircraftType: string | null,
  completedAt = "2026-07-31T11:00:00.000Z",
) {
  return { minutes, completedAt, eventId, productCode: "PAN", aircraftType };
}

function resolve(samples: ReturnType<typeof sample>[], aircraftType: string | null = "TYPE-A") {
  return resolveForecastDurationBasis({
    now: NOW,
    eventId: "current",
    productCode: "PAN",
    aircraftType,
    referenceDurationMinutes: 40,
    durationSamples: samples,
    interrupted: false,
    activeCapacity: 1,
    tuning: DEFAULT_FORECAST_TUNING_PROFILE,
  });
}

describe("forecast duration basis", () => {
  it("uses current-event aircraft/product samples before every broader basis", () => {
    const basis = resolve([
      sample(31, "current", "TYPE-A"),
      sample(60, "current", "TYPE-B"),
      sample(20, "historic", "TYPE-A"),
    ]);

    expect(basis).toMatchObject({
      dataBasisScope: "AIRCRAFT_PRODUCT_HISTORY",
      acceptedSampleSize: 1,
      aircraftType: "TYPE-A",
    });
    expect(basis.estimate.expectedMinutes).toBeLessThan(40);
  });

  it("uses broader current-event product samples before aircraft-specific history", () => {
    const basis = resolve([sample(34, "current", "TYPE-B"), sample(20, "historic", "TYPE-A")]);

    expect(basis.dataBasisScope).toBe("PRODUCT_HISTORY");
    expect(basis.estimate.expectedMinutes).toBeGreaterThan(30);
  });

  it("falls back through historical aircraft, historical product and reference", () => {
    expect(resolve([sample(32, "historic", "TYPE-A")]).dataBasisScope).toBe(
      "AIRCRAFT_PRODUCT_HISTORY",
    );
    expect(resolve([sample(33, "historic", "TYPE-B")]).dataBasisScope).toBe("PRODUCT_HISTORY");
    expect(resolve([])).toMatchObject({
      dataBasisScope: "REFERENCE_ONLY",
      acceptedSampleSize: 0,
      dataAgeMinutes: 0,
    });
  });

  it("reports the accepted robust sample count and age after rejecting an outlier", () => {
    const basis = resolve([
      sample(31, "current", "TYPE-A", "2026-07-31T11:30:00.000Z"),
      sample(32, "current", "TYPE-A", "2026-07-31T11:20:00.000Z"),
      sample(200, "current", "TYPE-A", "2026-07-31T11:10:00.000Z"),
    ]);

    expect(basis.acceptedSampleSize).toBe(2);
    expect(basis.dataAgeMinutes).toBe(30);
  });
});
