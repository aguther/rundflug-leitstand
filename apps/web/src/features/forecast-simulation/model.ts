import type {
  ForecastRotationStatus,
  ForecastUncertaintyReason,
  PredictionQuality,
} from "@rundflug/domain";

export interface TriangularDistribution {
  minimum: number;
  typical: number;
  maximum: number;
}

export interface SimulationIncidentPolicy {
  enabled: boolean;
  duration: TriangularDistribution;
}

export interface SimulationConfig {
  preset: SimulationPresetId;
  seed: number;
  startAt: string;
  endAt: string;
  aircraftCount: number;
  demandPersonsPerHour: number;
  automaticPrecallEnabled: boolean;
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

export const DEFAULT_PHASES: SimulationConfig["phases"] = {
  boarding: { minimum: 4, typical: 7, maximum: 12 },
  flight: { minimum: 15, typical: 20, maximum: 28 },
  deboarding: { minimum: 3, typical: 6, maximum: 12 },
  buffer: { minimum: 2, typical: 4, maximum: 8 },
};

const DEFAULT_INCIDENTS: SimulationConfig["incidents"] = {
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
  aircraftCount: 3,
  demandPersonsPerHour: 18,
  automaticPrecallEnabled: true,
  phases: DEFAULT_PHASES,
  incidents: DEFAULT_INCIDENTS,
};

export const SIMULATION_PRESETS: Readonly<Record<SimulationPresetId, SimulationConfig>> = {
  NORMAL: cloneConfig(BASE_CONFIG),
  PEAK_LOAD: { ...cloneConfig(BASE_CONFIG), preset: "PEAK_LOAD", demandPersonsPerHour: 36 },
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
    ["Boarding", config.phases.boarding, false],
    ["Flug", config.phases.flight, false],
    ["Deboarding", config.phases.deboarding, false],
    ["Puffer", config.phases.buffer, true],
    ["Tanken", config.incidents.refueling.duration, false],
    ["Geplante Pause", config.incidents.plannedPause.duration, false],
    ["Ungeplante Pause", config.incidents.unplannedPause.duration, false],
    ["Technischer Defekt", config.incidents.technicalDefect.duration, false],
  ] as const) {
    if (validateDistribution(distribution, allowZero))
      errors.push(`${label}: ungültige Verteilung.`);
  }
  if (
    !Number.isInteger(config.aircraftCount) ||
    config.aircraftCount < 1 ||
    config.aircraftCount > 12
  )
    errors.push("Die Zahl der Flugzeuge muss zwischen 1 und 12 liegen.");
  if (!Number.isFinite(config.demandPersonsPerHour) || config.demandPersonsPerHour < 0)
    errors.push("Die Nachfrage darf nicht negativ sein.");
  if (!Number.isInteger(config.seed) || config.seed < 1 || config.seed > 4_294_967_295)
    errors.push("Der Seed muss eine positive 32-Bit-Ganzzahl sein.");
  if (Date.parse(config.startAt) >= Date.parse(config.endAt))
    errors.push("Das Simulationsende muss nach dem Beginn liegen.");
  if (config.incidents.refueling.enabled && config.incidents.refueling.everyRotations < 1)
    errors.push("Das Tankintervall muss mindestens einen Umlauf betragen.");
  if (
    config.incidents.plannedPause.enabled &&
    config.incidents.plannedPause.everyOperatingMinutes < 1
  )
    errors.push("Das Pausenintervall muss mindestens eine Betriebsminute betragen.");
  if (
    config.incidents.unplannedPause.ratePerOperatingHour < 0 ||
    config.incidents.technicalDefect.ratePerOperatingHour < 0
  )
    errors.push("Ereignisraten dürfen nicht negativ sein.");
  if (
    config.incidents.technicalDefect.dayOutageProbability < 0 ||
    config.incidents.technicalDefect.dayOutageProbability > 1
  )
    errors.push("Die Tagesausfallwahrscheinlichkeit muss zwischen 0 und 100 Prozent liegen.");
  return errors;
}
