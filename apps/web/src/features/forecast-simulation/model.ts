import type {
  ForecastRotationStatus,
  ForecastTuningProfile,
  ForecastUncertaintyReason,
  PrecallTuningProfile,
  PredictionQuality,
} from "@rundflug/domain";
import { DEFAULT_FORECAST_TUNING_PROFILE, DEFAULT_PRECALL_TUNING_PROFILE } from "@rundflug/domain";

export interface TriangularDistribution {
  minimum: number;
  typical: number;
  maximum: number;
}

export interface SimulationIncidentPolicy {
  enabled: boolean;
  duration: TriangularDistribution;
}

export interface SimulationAdminParameters {
  plannedBoardingMinutes: number;
  productReferenceDurationMinutes: number;
  plannedDeboardingMinutes: number;
  plannedBufferMinutes: number;
  eventAutomaticPrecallEnabled: boolean;
  resourceGroupAutomaticPrecallEnabled: boolean;
  aircraftCount: number;
  aircraftType: string;
  passengerSeats: number;
  activePilotCount: number;
}

export interface SimulationRealityModel {
  demandPersonsPerHour: number;
  phases: {
    boarding: TriangularDistribution;
    flight: TriangularDistribution;
    deboarding: TriangularDistribution;
    buffer: TriangularDistribution;
  };
  incidents: {
    refueling: SimulationIncidentPolicy & { everyRotations: number };
    plannedPause: SimulationIncidentPolicy & { everyOperatingMinutes: number };
    unplannedPause: SimulationIncidentPolicy & { ratePerOperatingHour: number };
    technicalDefect: SimulationIncidentPolicy & {
      ratePerOperatingHour: number;
      dayOutageProbability: number;
    };
  };
}

export interface SimulationForecastTuning {
  forecast: ForecastTuningProfile;
  precall: PrecallTuningProfile;
  comparisonRuns: number;
}

export interface SimulationConfig {
  preset: SimulationPresetId;
  seed: number;
  startAt: string;
  endAt: string;
  adminParameters: SimulationAdminParameters;
  realityModel: SimulationRealityModel;
  forecastTuning: SimulationForecastTuning;
}

export type SimulationPresetId =
  | "NORMAL"
  | "PEAK_LOAD"
  | "AIRCRAFT_FAILURE"
  | "OPERATION_INTERRUPTION";

export type ManualIncidentType =
  | "REFUELING"
  | "UNPLANNED_PAUSE"
  | "TECHNICAL_DEFECT"
  | "EVENT_INTERRUPTION";

export interface ManualIncident {
  id: string;
  type: ManualIncidentType;
  at: string;
  aircraftId: string | null;
  durationMinutes: number;
  dayOutage: boolean;
}

export type SimulationAircraftState =
  | "AVAILABLE"
  | "ACTIVE"
  | "REFUELING"
  | "PLANNED_PAUSE"
  | "UNPLANNED_PAUSE"
  | "TECHNICAL_DEFECT"
  | "DAY_OUT";

export interface SimulationAircraft {
  id: string;
  registration: string;
  aircraftType: string;
  capacity: number;
}

export interface SimulationRotation {
  id: string;
  communicationNumber: number;
  passengerCount: number;
  createdAt: string;
  precalledAt: string | null;
  precallTrigger: "AUTOMATIC_PRECALL" | null;
  precallPredictionQuality: PredictionQuality | null;
  precallPredictedBoardingAt: string | null;
  precallAdaptiveLeadMinutes: number | null;
  aircraftId: string | null;
  calledAt: string | null;
  departedAt: string | null;
  landedAt: string | null;
  completedAt: string | null;
  boardingMinutes: number | null;
  flightMinutes: number | null;
  deboardingMinutes: number | null;
  bufferMinutes: number | null;
}

export interface SimulationForecastSnapshot {
  rotationId: string;
  capturedAt: string;
  status: ForecastRotationStatus;
  quality: PredictionQuality;
  lowerMinutes: number;
  upperMinutes: number;
  plannedBoardingAt: string;
  predictedBoardingAt: string;
  predictedDepartureAt: string;
  predictedLandingAt: string;
  predictedCompletionAt: string;
  sampleSize: number;
  dataAgeMinutes: number;
  activeCapacity: number;
  uncertaintyReasons: ForecastUncertaintyReason[];
  countdownDisplayed: boolean;
}

export type SimulationEventType =
  | "FLIGHT_GROUP_PRECALLED"
  | "ROTATION_CALLED"
  | "ROTATION_DEPARTED"
  | "ROTATION_LANDED"
  | "ROTATION_COMPLETED"
  | "REFUELING_STARTED"
  | "PLANNED_PAUSE_STARTED"
  | "UNPLANNED_PAUSE_STARTED"
  | "TECHNICAL_DEFECT_REPORTED"
  | "AIRCRAFT_DAY_OUT"
  | "AIRCRAFT_RETURN_CONFIRMED"
  | "EVENT_INTERRUPTED"
  | "EVENT_RESUMED";

export interface SimulationEvent {
  id: string;
  type: SimulationEventType;
  occurredAt: string;
  aircraftId: string | null;
  rotationId: string | null;
  details: string;
  forecastRecalculatedAt: string;
}

export interface ForecastMetricSummary {
  samples: number;
  maeMinutes: number | null;
  medianAbsoluteErrorMinutes: number | null;
  p90AbsoluteErrorMinutes: number | null;
  biasMinutes: number | null;
}

export interface SimulationMetrics {
  boarding: ForecastMetricSummary & {
    windowCoveragePercent: number | null;
    averageWindowWidthMinutes: number | null;
  };
  departure: ForecastMetricSummary;
  landing: ForecastMetricSummary;
  completion: ForecastMetricSummary;
  horizons: Record<"15" | "30" | "60", ForecastMetricSummary>;
  qualities: Record<PredictionQuality, number>;
  uncertaintyReasons: Record<ForecastUncertaintyReason, number>;
  precall: {
    eligibleGroups: number;
    precalledGroups: number;
    coveragePercent: number | null;
    medianGateWaitMinutes: number | null;
    p90GateWaitMinutes: number | null;
    sameTickCount: number;
    uncertainPrecallCount: number;
  };
  uncertainCountdownViolations: number;
  maximumEventReactionSeconds: number;
}

export interface SimulationResult {
  config: SimulationConfig;
  aircraft: SimulationAircraft[];
  rotations: SimulationRotation[];
  events: SimulationEvent[];
  snapshots: SimulationForecastSnapshot[];
  metrics: SimulationMetrics;
}

export const FORECAST_UNCERTAINTY_REASON_LABELS: Record<ForecastUncertaintyReason, string> = {
  OPERATION_INTERRUPTED: "Betrieb unterbrochen",
  EMERGENCY_MODE: "Notfallmodus",
  RESOURCE_GROUP_INACTIVE: "Ressourcengruppe nicht aktiv",
  NO_ACTIVE_CAPACITY: "keine aktive Kapazität",
  STALE_PREDICTION: "Prognose älter als fünf Minuten",
};

export function forecastUncertaintyLabel(reasons: readonly ForecastUncertaintyReason[]): string {
  return reasons.length === 0
    ? "nicht näher bestimmt"
    : reasons.map((reason) => FORECAST_UNCERTAINTY_REASON_LABELS[reason]).join(", ");
}

export const DEFAULT_PHASES: SimulationRealityModel["phases"] = {
  boarding: { minimum: 4, typical: 7, maximum: 12 },
  flight: { minimum: 15, typical: 20, maximum: 28 },
  deboarding: { minimum: 3, typical: 6, maximum: 12 },
  buffer: { minimum: 2, typical: 4, maximum: 8 },
};

const DEFAULT_INCIDENTS: SimulationRealityModel["incidents"] = {
  refueling: {
    enabled: true,
    everyRotations: 5,
    duration: { minimum: 8, typical: 12, maximum: 18 },
  },
  plannedPause: {
    enabled: true,
    everyOperatingMinutes: 120,
    duration: { minimum: 15, typical: 20, maximum: 30 },
  },
  unplannedPause: {
    enabled: true,
    ratePerOperatingHour: 0.2,
    duration: { minimum: 5, typical: 12, maximum: 25 },
  },
  technicalDefect: {
    enabled: true,
    ratePerOperatingHour: 0.08,
    duration: { minimum: 15, typical: 45, maximum: 120 },
    dayOutageProbability: 0.2,
  },
};

function cloneConfig(config: SimulationConfig): SimulationConfig {
  return structuredClone(config);
}

const BASE_CONFIG: SimulationConfig = {
  preset: "NORMAL",
  seed: 20260722,
  startAt: "2026-07-22T08:00:00.000Z",
  endAt: "2026-07-22T16:00:00.000Z",
  adminParameters: {
    plannedBoardingMinutes: 8,
    productReferenceDurationMinutes: 20,
    plannedDeboardingMinutes: 5,
    plannedBufferMinutes: 3,
    eventAutomaticPrecallEnabled: true,
    resourceGroupAutomaticPrecallEnabled: true,
    aircraftCount: 3,
    aircraftType: "Simulation 4S",
    passengerSeats: 4,
    activePilotCount: 3,
  },
  realityModel: {
    demandPersonsPerHour: 18,
    phases: DEFAULT_PHASES,
    incidents: DEFAULT_INCIDENTS,
  },
  forecastTuning: {
    forecast: { ...DEFAULT_FORECAST_TUNING_PROFILE },
    precall: { ...DEFAULT_PRECALL_TUNING_PROFILE },
    comparisonRuns: 25,
  },
};

export const SIMULATION_PRESETS: Readonly<Record<SimulationPresetId, SimulationConfig>> = {
  NORMAL: cloneConfig(BASE_CONFIG),
  PEAK_LOAD: {
    ...cloneConfig(BASE_CONFIG),
    preset: "PEAK_LOAD",
    realityModel: { ...cloneConfig(BASE_CONFIG).realityModel, demandPersonsPerHour: 36 },
  },
  AIRCRAFT_FAILURE: { ...cloneConfig(BASE_CONFIG), preset: "AIRCRAFT_FAILURE" },
  OPERATION_INTERRUPTION: { ...cloneConfig(BASE_CONFIG), preset: "OPERATION_INTERRUPTION" },
};

export const SIMULATION_PRESET_LABELS: Record<SimulationPresetId, string> = {
  NORMAL: "Normalbetrieb",
  PEAK_LOAD: "Stoßlast",
  AIRCRAFT_FAILURE: "Flugzeugausfall",
  OPERATION_INTERRUPTION: "Betriebsunterbrechung",
};

export function simulationConfigForPreset(preset: SimulationPresetId): SimulationConfig {
  return cloneConfig(SIMULATION_PRESETS[preset]);
}

export function validateDistribution(
  distribution: TriangularDistribution,
  allowZero = false,
): string | null {
  const floor = allowZero ? 0 : Number.EPSILON;
  if (
    !Number.isFinite(distribution.minimum) ||
    !Number.isFinite(distribution.typical) ||
    !Number.isFinite(distribution.maximum) ||
    distribution.minimum < floor ||
    distribution.minimum > distribution.typical ||
    distribution.typical > distribution.maximum
  ) {
    return "Es gilt Minimum ≤ typisch ≤ Maximum; alle Werte müssen gültig sein.";
  }
  return null;
}

export function validateSimulationConfig(config: SimulationConfig): string[] {
  const errors: string[] = [];
  for (const [label, distribution, allowZero] of [
    ["Boarding", config.realityModel.phases.boarding, false],
    ["Flug", config.realityModel.phases.flight, false],
    ["Deboarding", config.realityModel.phases.deboarding, false],
    ["Puffer", config.realityModel.phases.buffer, true],
    ["Tanken", config.realityModel.incidents.refueling.duration, false],
    ["Geplante Pause", config.realityModel.incidents.plannedPause.duration, false],
    ["Ungeplante Pause", config.realityModel.incidents.unplannedPause.duration, false],
    ["Technischer Defekt", config.realityModel.incidents.technicalDefect.duration, false],
  ] as const) {
    if (validateDistribution(distribution, allowZero))
      errors.push(`${label}: ungültige Verteilung.`);
  }
  if (
    !Number.isInteger(config.adminParameters.aircraftCount) ||
    config.adminParameters.aircraftCount < 1 ||
    config.adminParameters.aircraftCount > 12
  )
    errors.push("Die Zahl der Flugzeuge muss zwischen 1 und 12 liegen.");
  if (
    !Number.isInteger(config.adminParameters.passengerSeats) ||
    config.adminParameters.passengerSeats < 1 ||
    config.adminParameters.passengerSeats > 100
  )
    errors.push("Die Sitzplatzzahl muss zwischen 1 und 100 liegen.");
  if (
    !Number.isInteger(config.adminParameters.activePilotCount) ||
    config.adminParameters.activePilotCount < 0 ||
    config.adminParameters.activePilotCount > 100
  )
    errors.push("Die aktive Pilotenkapazität muss zwischen 0 und 100 liegen.");
  if (config.adminParameters.aircraftType.trim().length < 2)
    errors.push("Der Flugzeugtyp muss mindestens zwei Zeichen lang sein.");
  for (const [label, value, minimum] of [
    ["Plan Boarding", config.adminParameters.plannedBoardingMinutes, 1],
    ["Produkt-Referenzdauer", config.adminParameters.productReferenceDurationMinutes, 1],
    ["Plan Ausstieg", config.adminParameters.plannedDeboardingMinutes, 1],
    ["Plan Puffer", config.adminParameters.plannedBufferMinutes, 0],
  ] as const) {
    if (!Number.isInteger(value) || value < minimum || value > 600) {
      errors.push(`${label} muss eine ganze Minute zwischen ${minimum} und 600 sein.`);
    }
  }
  if (
    !Number.isFinite(config.realityModel.demandPersonsPerHour) ||
    config.realityModel.demandPersonsPerHour < 0
  )
    errors.push("Die Nachfrage darf nicht negativ sein.");
  if (!Number.isInteger(config.seed) || config.seed < 1 || config.seed > 4_294_967_295)
    errors.push("Der Seed muss eine positive 32-Bit-Ganzzahl sein.");
  if (Date.parse(config.startAt) >= Date.parse(config.endAt))
    errors.push("Das Simulationsende muss nach dem Beginn liegen.");
  if (
    config.realityModel.incidents.refueling.enabled &&
    config.realityModel.incidents.refueling.everyRotations < 1
  )
    errors.push("Das Tankintervall muss mindestens einen Umlauf betragen.");
  if (
    config.realityModel.incidents.plannedPause.enabled &&
    config.realityModel.incidents.plannedPause.everyOperatingMinutes < 1
  )
    errors.push("Das Pausenintervall muss mindestens eine Betriebsminute betragen.");
  if (
    config.realityModel.incidents.unplannedPause.ratePerOperatingHour < 0 ||
    config.realityModel.incidents.technicalDefect.ratePerOperatingHour < 0
  )
    errors.push("Ereignisraten dürfen nicht negativ sein.");
  if (
    config.realityModel.incidents.technicalDefect.dayOutageProbability < 0 ||
    config.realityModel.incidents.technicalDefect.dayOutageProbability > 1
  )
    errors.push("Die Tagesausfallwahrscheinlichkeit muss zwischen 0 und 100 Prozent liegen.");
  const forecast = config.forecastTuning.forecast;
  if (
    !Number.isInteger(forecast.maximumSamples) ||
    forecast.maximumSamples < 1 ||
    forecast.maximumSamples > 100
  )
    errors.push("Die maximale Lernstichprobe muss zwischen 1 und 100 liegen.");
  if (
    forecast.referenceWeight <= 0 ||
    forecast.firstSampleWeight <= 0 ||
    forecast.recencyWeightIncrement < 0
  )
    errors.push("Prognosegewichte müssen positiv sein; der Gewichtszuwachs darf null sein.");
  if (
    forecast.referenceOutlierMultiplier < 1 ||
    forecast.madMultiplier < 0 ||
    forecast.minimumMadToleranceRatio < 0
  )
    errors.push("Die Ausreißer- und MAD-Parameter sind ungültig.");
  if (
    !Number.isInteger(forecast.stableMinimumSamples) ||
    forecast.stableMinimumSamples < 1 ||
    forecast.stableMinimumSamples > forecast.maximumSamples
  )
    errors.push("Die stabile Mindeststichprobe muss zur maximalen Stichprobe passen.");
  if (
    forecast.stableMaximumMeanDeviationMinutes < 0 ||
    forecast.stableMarginMinutes < 0 ||
    forecast.changingMarginMinutes < 0
  )
    errors.push("Qualitätsgrenzen und Prognosemargen dürfen nicht negativ sein.");
  const precall = config.forecastTuning.precall;
  if (
    precall.desiredGateWaitMinutes < 0 ||
    precall.baselineLeadMinutes < 0 ||
    precall.minimumLeadMinutes < 0 ||
    precall.maximumLeadMinutes < precall.minimumLeadMinutes ||
    precall.correctionFactor < 0 ||
    !Number.isInteger(precall.observationSampleLimit) ||
    precall.observationSampleLimit < 1 ||
    precall.observationSampleLimit > 100 ||
    precall.gateCooldownMinutes < 0 ||
    precall.gateCooldownMinutes > 60
  )
    errors.push("Die experimentellen Voraufrufparameter sind ungültig.");
  if (
    !Number.isInteger(config.forecastTuning.comparisonRuns) ||
    config.forecastTuning.comparisonRuns < 5 ||
    config.forecastTuning.comparisonRuns > 100
  )
    errors.push("Der A/B-Vergleich muss zwischen 5 und 100 Läufe verwenden.");
  return errors;
}
