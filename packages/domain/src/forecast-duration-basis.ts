import { estimateDuration, selectRobustDurationSamples } from "./forecast-sampling";
import type {
  DurationEstimate,
  ForecastDataBasisScope,
  ForecastTimelineDurationSample,
  ForecastTuningProfile,
} from "./forecast-types";

export interface ForecastDurationBasis {
  estimate: DurationEstimate;
  dataBasisScope: ForecastDataBasisScope;
  dataAgeMinutes: number;
  acceptedSampleSize: number;
  aircraftType: string | null;
  referenceDurationMinutes: number;
}

export interface ResolveForecastDurationBasisInput {
  now: string;
  eventId: string;
  productCode: string;
  aircraftType: string | null;
  referenceDurationMinutes: number;
  durationSamples: readonly ForecastTimelineDurationSample[];
  interrupted: boolean;
  activeCapacity: number;
  tuning: ForecastTuningProfile;
}

function newestFirst(
  samples: readonly ForecastTimelineDurationSample[],
): ForecastTimelineDurationSample[] {
  return [...samples].sort(
    (left, right) =>
      Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
      left.productCode.localeCompare(right.productCode) ||
      (left.aircraftType ?? "").localeCompare(right.aircraftType ?? ""),
  );
}

/**
 * Resolves the one duration basis used by lane planning, replay and visible projections.
 * A broader same-day product basis intentionally wins over aircraft-specific historical data.
 */
export function resolveForecastDurationBasis(
  input: ResolveForecastDurationBasisInput,
): ForecastDurationBasis {
  const productSamples = newestFirst(
    input.durationSamples.filter((sample) => sample.productCode === input.productCode),
  );
  const currentEventSamples = productSamples.filter((sample) => sample.eventId === input.eventId);
  const currentEventAircraftSamples = input.aircraftType
    ? currentEventSamples.filter((sample) => sample.aircraftType === input.aircraftType)
    : [];
  const historicalSamples = productSamples.filter((sample) => sample.eventId !== input.eventId);
  const historicalAircraftSamples = input.aircraftType
    ? historicalSamples.filter((sample) => sample.aircraftType === input.aircraftType)
    : [];

  let selected: ForecastTimelineDurationSample[] = [];
  let dataBasisScope: ForecastDataBasisScope = "REFERENCE_ONLY";
  if (currentEventAircraftSamples.length > 0) {
    selected = currentEventAircraftSamples;
    dataBasisScope = "AIRCRAFT_PRODUCT_HISTORY";
  } else if (currentEventSamples.length > 0) {
    selected = currentEventSamples;
    dataBasisScope = "PRODUCT_HISTORY";
  } else if (historicalAircraftSamples.length > 0) {
    selected = historicalAircraftSamples;
    dataBasisScope = "AIRCRAFT_PRODUCT_HISTORY";
  } else if (historicalSamples.length > 0) {
    selected = historicalSamples;
    dataBasisScope = "PRODUCT_HISTORY";
  }

  selected = selected.slice(0, input.tuning.maximumSamples);
  const chronologicalValues = [...selected].reverse().map((sample) => sample.minutes);
  const acceptedValues = new Set(
    selectRobustDurationSamples(chronologicalValues, input.referenceDurationMinutes, input.tuning),
  );
  const estimate = estimateDuration({
    referenceMinutes: input.referenceDurationMinutes,
    actualDurationsMinutes: chronologicalValues,
    interrupted: input.interrupted,
    activeCapacity: input.activeCapacity,
    tuning: input.tuning,
  });
  const newestAcceptedSample = selected.find((sample) => acceptedValues.has(sample.minutes));
  const nowMs = Date.parse(input.now);
  const completedAtMs = newestAcceptedSample ? Date.parse(newestAcceptedSample.completedAt) : nowMs;
  return {
    estimate,
    dataBasisScope: estimate.sampleCount === 0 ? "REFERENCE_ONLY" : dataBasisScope,
    dataAgeMinutes: Math.max(0, (nowMs - completedAtMs) / 60_000),
    acceptedSampleSize: estimate.sampleCount,
    aircraftType: input.aircraftType,
    referenceDurationMinutes: input.referenceDurationMinutes,
  };
}
