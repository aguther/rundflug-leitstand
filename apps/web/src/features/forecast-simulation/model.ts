import type {
  SimulationPlanOperation as ImportedSimulationPlanOperation,
  SimulationRecurringOperationalRule as ImportedSimulationRecurringOperationalRule,
} from "@rundflug/contracts";
import type {
  DispatchPlanningLimits,
  ForecastRotationStatus,
  ForecastTuningProfile,
  ForecastUncertaintyReason,
  PrecallTuningProfile,
  PredictionQuality,
} from "@rundflug/domain";
import { DEFAULT_FORECAST_TUNING_PROFILE, DEFAULT_PRECALL_TUNING_PROFILE } from "@rundflug/domain";

export const SIMULATION_DISPATCH_PLANNING_LIMITS: Partial<DispatchPlanningLimits> = {
  maximumGroupsPerResourceGroup: 12,
  maximumGroupsPerProduct: 10,
  maximumWaves: 2,
  maximumCandidatesPerStep: 6,
  beamWidth: 2,
};

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

export type SimulationDemandProfileId =
  | "UNIFORM"
  | "OPENING_RUSH"
  | "TWO_WAVES"
  | "LATE_RUSH"
  | "CUSTOM";

export interface SimulationDemandWindow {
  startOffsetMinutes: number;
  endOffsetMinutes: number;
  personsPerHour: number;
}

export interface SimulationDemand {
  profile: SimulationDemandProfileId;
  windows: SimulationDemandWindow[];
}

export interface SimulationSchedule {
  timeZone: string;
  salesStartAt: string;
  salesEndAt: string;
  operationsStartAt: string;
  operationsEndAt: string;
}

export interface SimulationRealityModel {
  demand: SimulationDemand;
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
  availabilityModel: "SCALAR" | "TIME_DEPENDENT";
}

export interface SimulationConfig {
  preset: SimulationPresetId;
  seed: number;
  schedule: SimulationSchedule;
  adminParameters: SimulationAdminParameters;
  realityModel: SimulationRealityModel;
  forecastTuning: SimulationForecastTuning;
  operationalModel?: SimulationOperationalModel;
  demandByProduct?: Record<string, SimulationDemand>;
  plannedOperations: SimulationPlannedOperation[];
  recurringRules?: SimulationRecurringOperationalRule[];
}

export interface SimulationGate {
  id: string;
  label: string;
  travelLeadMinutes?: number;
}

export interface SimulationResourceGroup {
  id: string;
  name: string;
  shortCode: string;
  gateId: string;
  automaticPrecallEnabled: boolean;
}

export interface SimulationProduct {
  id: string;
  name: string;
  code: string;
  resourceGroupId: string;
  gateId: string;
  referenceCapacity: number;
  referenceDurationMinutes: number;
}

export interface SimulationPilot {
  id: string;
  operationalCode: string;
  active: boolean;
}

export interface SimulationOperationalModel {
  sourceName: string;
  gates: SimulationGate[];
  resourceGroups: SimulationResourceGroup[];
  aircraft: SimulationAircraft[];
  pilots: SimulationPilot[];
  products: SimulationProduct[];
}

export interface SimulationPlannedOperation
  extends Omit<
    ImportedSimulationPlanOperation,
    "scopeKey" | "afterCurrentRotation" | "effectMode" | "durationMultiplierPercent"
  > {
  scopeId: string;
  afterRotationId: string | null;
  unresolvedAfterCurrentRotation: boolean;
  effectMode?: "BLOCKING" | "SLOWDOWN";
  durationMultiplierPercent?: number | null;
}

export interface SimulationRecurringOperationalRule
  extends Omit<ImportedSimulationRecurringOperationalRule, "scopeKey"> {
  scopeId: string;
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
  refuelReminderThreshold?: number;
  resourceGroupId?: string;
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
  precallGateTravelLeadMinutes?: number | null;
  precallEffectiveLeadMinutes?: number | null;
  precallStatus?: "WAITING" | "PREPARE" | "GO_TO_GATE";
  aircraftId: string | null;
  pilotId?: string | null;
  productId?: string;
  productName?: string;
  productCode?: string;
  resourceGroupId?: string;
  gateLabel?: string;
  calledAt: string | null;
  departedAt: string | null;
  landedAt: string | null;
  completedAt: string | null;
  boardingMinutes: number | null;
  flightMinutes: number | null;
  deboardingMinutes: number | null;
  bufferMinutes: number | null;
  dispatchBatchId?: string | null;
  dispatchOrder?: number | null;
  dispatchGroupCount?: number;
  dispatchCapacity?: number | null;
  dispatchConfirmedOvertakeCount?: number;
  dispatchOvertakeCount?: number;
  dispatchMaximumOvertakeCount?: number;
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
  forecastState?: import("@rundflug/domain").ForecastState;
  forecastReason?: import("@rundflug/domain").PublicForecastReason | null;
  dispatchBatchId?: string | null;
  dispatchUnplannedReason?: import("@rundflug/domain").DispatchUnplannedReason | null;
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
  | "EVENT_RESUMED"
  | "PLANNED_OPERATION_STARTED"
  | "PLANNED_OPERATION_ENDED";

export interface SimulationEvent {
  id: string;
  type: SimulationEventType;
  occurredAt: string;
  aircraftId: string | null;
  pilotId?: string | null;
  plannedOperationId?: string | null;
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
  stability: {
    changes: number;
    averageAbsoluteChangeMinutes: number | null;
    maximumJumpMinutes: number;
    jumpsOver15Minutes: number;
    jumpsOver30Minutes: number;
    maximumWindowWidthMinutes: number;
  };
  operations: {
    completedRotations: number;
    overtimeMinutes: number;
    aircraftUtilizationPercent: number | null;
    averageSeatUtilizationPercent: number | null;
    averagePassengerWaitMinutes: number | null;
    p90PassengerWaitMinutes: number | null;
    maximumPassengerWaitMinutes: number | null;
    overtakes: number;
    overtakeRatePercent: number | null;
    maximumProductServiceDeficitMinutes: number | null;
  };
  dispatch: {
    passengersPerHour: number | null;
    passengersPerAircraftHour: number | null;
    offeredSeats: number;
    occupiedSeats: number;
    averageSeatUtilizationPercent: number | null;
    p50PassengerWaitMinutes: number | null;
    p90PassengerWaitMinutes: number | null;
    maximumPassengerWaitMinutes: number | null;
    waitMinutesByProduct: Record<string, number>;
    projectedOvertakes: number;
    maximumOvertakesPerGroup: number;
    serviceSharePercentByProduct: Record<string, number>;
    maximumProductServiceDeficitMinutes: number | null;
    unnecessaryPlanChanges: number;
    prepareDemotions: number;
    goToGateReplans: number;
  };
  uncertainCountdownViolations: number;
  maximumEventReactionSeconds: number;
}

export interface SimulationDispatchDiagnostics {
  unnecessaryPlanChanges: number;
  prepareDemotions: number;
  goToGateReplans: number;
}

export interface SimulationResult {
  config: SimulationConfig;
  runWindow: {
    startAt: string;
    endAt: string;
  };
  aircraft: SimulationAircraft[];
  pilots?: SimulationPilot[];
  plannedOperations?: SimulationPlannedOperation[];
  recurringRules?: SimulationRecurringOperationalRule[];
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
  NO_FORECAST_CAPACITY: "keine Prognosebahn verfügbar",
  NO_FITTING_AIRCRAFT: "kein ausreichend großes Flugzeug verfügbar",
  PLANNED_CONSTRAINT_OVERDUE: "geplante Einschränkung überfällig",
  UNPLANNED_RESOURCE_RETURN: "Rückkehrzeit einer Ressource unklar",
  STALE_PREDICTION: "Prognose älter als fünf Minuten",
};

export function forecastUncertaintyLabel(reasons: readonly ForecastUncertaintyReason[]): string {
  return reasons.length === 0
    ? "nicht näher bestimmt"
    : reasons.map((reason) => FORECAST_UNCERTAINTY_REASON_LABELS[reason]).join(", ");
}

export const SIMULATION_DEMAND_PROFILE_LABELS: Record<SimulationDemandProfileId, string> = {
  UNIFORM: "Gleichmäßig",
  OPENING_RUSH: "Morgenandrang",
  TWO_WAVES: "Zwei Wellen",
  LATE_RUSH: "Später Andrang",
  CUSTOM: "Benutzerdefiniert",
};

const MINUTE_MS = 60_000;
const DEFAULT_DEMAND_PERSONS_PER_HOUR = 18;

type DemandTemplateWindow = {
  endRatio: number;
  intensityAtDefault: number;
};

const DEMAND_TEMPLATES: Record<
  Exclude<SimulationDemandProfileId, "CUSTOM">,
  readonly DemandTemplateWindow[]
> = {
  UNIFORM: [{ endRatio: 1, intensityAtDefault: 18 }],
  OPENING_RUSH: [
    { endRatio: 0.25, intensityAtDefault: 42 },
    { endRatio: 1, intensityAtDefault: 10 },
  ],
  TWO_WAVES: [
    { endRatio: 0.1875, intensityAtDefault: 40 },
    { endRatio: 0.5625, intensityAtDefault: 8 },
    { endRatio: 0.75, intensityAtDefault: 32 },
    { endRatio: 1, intensityAtDefault: 6 },
  ],
  LATE_RUSH: [
    { endRatio: 0.75, intensityAtDefault: 10 },
    { endRatio: 1, intensityAtDefault: 42 },
  ],
};

function roundedDemandRate(value: number): number {
  return Math.round(value * 100) / 100;
}

export function salesDurationMinutes(schedule: SimulationSchedule): number {
  return (Date.parse(schedule.salesEndAt) - Date.parse(schedule.salesStartAt)) / MINUTE_MS;
}

export function calculateDemandSummary(
  demand: SimulationDemand,
  salesMinutes: number,
): {
  averagePersonsPerHour: number;
  expectedPersons: number;
} {
  if (!Number.isFinite(salesMinutes) || salesMinutes <= 0) {
    return { averagePersonsPerHour: 0, expectedPersons: 0 };
  }
  const expectedPersons = demand.windows.reduce((total, window) => {
    const durationMinutes = Math.max(0, window.endOffsetMinutes - window.startOffsetMinutes);
    return total + (window.personsPerHour * durationMinutes) / 60;
  }, 0);
  return {
    averagePersonsPerHour: expectedPersons / (salesMinutes / 60),
    expectedPersons,
  };
}

export function calculateCombinedDemandSummary(
  demands: readonly SimulationDemand[],
  salesMinutes: number,
): {
  averagePersonsPerHour: number;
  expectedPersons: number;
} {
  return demands.reduce(
    (total, demand) => {
      const summary = calculateDemandSummary(demand, salesMinutes);
      return {
        averagePersonsPerHour: total.averagePersonsPerHour + summary.averagePersonsPerHour,
        expectedPersons: total.expectedPersons + summary.expectedPersons,
      };
    },
    { averagePersonsPerHour: 0, expectedPersons: 0 },
  );
}

export function calculateSimulationDemandSummary(config: SimulationConfig): {
  averagePersonsPerHour: number;
  expectedPersons: number;
} {
  const demands = config.operationalModel
    ? config.operationalModel.products.flatMap((product) => {
        const demand = config.demandByProduct?.[product.id];
        return demand ? [demand] : [];
      })
    : [config.realityModel.demand];
  return calculateCombinedDemandSummary(demands, salesDurationMinutes(config.schedule));
}

export function demandForProfile(
  profile: Exclude<SimulationDemandProfileId, "CUSTOM">,
  salesMinutes: number,
  averagePersonsPerHour = DEFAULT_DEMAND_PERSONS_PER_HOUR,
): SimulationDemand {
  const durationMinutes = Math.max(1, Math.round(salesMinutes));
  const effectiveAverage =
    Number.isFinite(averagePersonsPerHour) && averagePersonsPerHour > 0
      ? averagePersonsPerHour
      : DEFAULT_DEMAND_PERSONS_PER_HOUR;
  const scale = effectiveAverage / DEFAULT_DEMAND_PERSONS_PER_HOUR;
  let previousEnd = 0;
  return {
    profile,
    windows: DEMAND_TEMPLATES[profile].map((window, index, entries) => {
      const startOffsetMinutes = previousEnd;
      const endOffsetMinutes =
        index === entries.length - 1
          ? durationMinutes
          : Math.round(window.endRatio * durationMinutes);
      previousEnd = endOffsetMinutes;
      return {
        startOffsetMinutes,
        endOffsetMinutes,
        personsPerHour: roundedDemandRate(window.intensityAtDefault * scale),
      };
    }),
  };
}

export function rescaleDemandWindows(
  demand: SimulationDemand,
  previousSalesMinutes: number,
  nextSalesMinutes: number,
): SimulationDemand {
  if (
    !Number.isFinite(previousSalesMinutes) ||
    previousSalesMinutes <= 0 ||
    !Number.isFinite(nextSalesMinutes) ||
    nextSalesMinutes <= 0
  ) {
    return demand;
  }
  const scale = nextSalesMinutes / previousSalesMinutes;
  return {
    ...demand,
    windows: demand.windows.map((window) => ({
      ...window,
      startOffsetMinutes: Math.round(window.startOffsetMinutes * scale),
      endOffsetMinutes: Math.round(window.endOffsetMinutes * scale),
    })),
  };
}

export function rescaleDemandByProduct(
  demandByProduct: Readonly<Record<string, SimulationDemand>>,
  previousSalesMinutes: number,
  nextSalesMinutes: number,
): Record<string, SimulationDemand> {
  return Object.fromEntries(
    Object.entries(demandByProduct).map(([productId, demand]) => [
      productId,
      rescaleDemandWindows(demand, previousSalesMinutes, nextSalesMinutes),
    ]),
  );
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
  schedule: {
    timeZone: "Europe/Berlin",
    salesStartAt: "2026-07-22T07:00:00.000Z",
    salesEndAt: "2026-07-22T15:00:00.000Z",
    operationsStartAt: "2026-07-22T08:00:00.000Z",
    operationsEndAt: "2026-07-22T16:00:00.000Z",
  },
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
    demand: demandForProfile("TWO_WAVES", 8 * 60),
    phases: DEFAULT_PHASES,
    incidents: DEFAULT_INCIDENTS,
  },
  forecastTuning: {
    forecast: { ...DEFAULT_FORECAST_TUNING_PROFILE },
    precall: { ...DEFAULT_PRECALL_TUNING_PROFILE },
    comparisonRuns: 25,
    availabilityModel: "TIME_DEPENDENT",
  },
  plannedOperations: [],
  recurringRules: [],
};

export const SIMULATION_PRESETS: Readonly<Record<SimulationPresetId, SimulationConfig>> = {
  NORMAL: cloneConfig(BASE_CONFIG),
  PEAK_LOAD: {
    ...cloneConfig(BASE_CONFIG),
    preset: "PEAK_LOAD",
    realityModel: {
      ...cloneConfig(BASE_CONFIG).realityModel,
      demand: demandForProfile("TWO_WAVES", 8 * 60, 36),
    },
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

function localDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
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
    config.adminParameters.aircraftCount > (config.operationalModel ? 200 : 12)
  )
    errors.push(
      `Die Zahl der Flugzeuge muss zwischen 1 und ${config.operationalModel ? 200 : 12} liegen.`,
    );
  if (
    !Number.isInteger(config.adminParameters.passengerSeats) ||
    config.adminParameters.passengerSeats < 1 ||
    config.adminParameters.passengerSeats > 100
  )
    errors.push("Die Sitzplatzzahl muss zwischen 1 und 100 liegen.");
  if (
    !Number.isInteger(config.adminParameters.activePilotCount) ||
    config.adminParameters.activePilotCount < 0 ||
    config.adminParameters.activePilotCount > 200
  )
    errors.push("Die aktive Pilotenkapazität muss zwischen 0 und 200 liegen.");
  if (config.adminParameters.aircraftType.trim().length < 2)
    errors.push("Der Flugzeugtyp muss mindestens zwei Zeichen lang sein.");
  for (const [label, value, minimum] of [
    ["Plan Boarding", config.adminParameters.plannedBoardingMinutes, 1],
    [
      "Produkt-Referenzzeit Offblock–Onblock",
      config.adminParameters.productReferenceDurationMinutes,
      1,
    ],
    ["Plan Ausstieg", config.adminParameters.plannedDeboardingMinutes, 1],
    ["Plan Puffer", config.adminParameters.plannedBufferMinutes, 0],
  ] as const) {
    if (!Number.isInteger(value) || value < minimum || value > 600) {
      errors.push(`${label} muss eine ganze Minute zwischen ${minimum} und 600 sein.`);
    }
  }
  if (!Number.isInteger(config.seed) || config.seed < 1 || config.seed > 4_294_967_295)
    errors.push("Der Seed muss eine positive 32-Bit-Ganzzahl sein.");
  const scheduleValues = [
    config.schedule.salesStartAt,
    config.schedule.salesEndAt,
    config.schedule.operationsStartAt,
    config.schedule.operationsEndAt,
  ];
  if (scheduleValues.some((value) => Number.isNaN(Date.parse(value)))) {
    errors.push("Alle Tageszeiten müssen gültige Zeitpunkte sein.");
  } else {
    try {
      const localDates = new Set(
        scheduleValues.map((value) => localDate(value, config.schedule.timeZone)),
      );
      if (localDates.size !== 1) {
        errors.push("Verkauf und Flugbetrieb müssen am selben Veranstaltungstag liegen.");
      }
    } catch {
      errors.push("Die Simulationszeitzone ist ungültig.");
    }
    if (Date.parse(config.schedule.salesStartAt) >= Date.parse(config.schedule.salesEndAt)) {
      errors.push("Das Verkaufsende muss nach dem Verkaufsbeginn liegen.");
    }
    if (
      Date.parse(config.schedule.operationsStartAt) >= Date.parse(config.schedule.operationsEndAt)
    ) {
      errors.push("Das Betriebsende muss nach dem Betriebsbeginn liegen.");
    }
    if (Date.parse(config.schedule.salesEndAt) > Date.parse(config.schedule.operationsEndAt)) {
      errors.push("Der Verkauf darf nicht nach dem Flugbetrieb enden.");
    }
  }
  const demandDuration = salesDurationMinutes(config.schedule);
  if (!config.operationalModel) {
    const demandWindows = [...config.realityModel.demand.windows].sort(
      (left, right) =>
        left.startOffsetMinutes - right.startOffsetMinutes ||
        left.endOffsetMinutes - right.endOffsetMinutes,
    );
    for (const [index, window] of demandWindows.entries()) {
      if (
        !Number.isInteger(window.startOffsetMinutes) ||
        !Number.isInteger(window.endOffsetMinutes) ||
        window.startOffsetMinutes < 0 ||
        window.endOffsetMinutes <= window.startOffsetMinutes ||
        window.endOffsetMinutes > demandDuration
      ) {
        errors.push(`Nachfragefenster ${index + 1} liegt außerhalb des Verkaufszeitraums.`);
      }
      if (!Number.isFinite(window.personsPerHour) || window.personsPerHour < 0) {
        errors.push(`Nachfragefenster ${index + 1} besitzt eine ungültige Nachfrage.`);
      }
      if (
        index > 0 &&
        (demandWindows[index - 1]?.endOffsetMinutes ?? 0) > window.startOffsetMinutes
      ) {
        errors.push(`Nachfragefenster ${index} und ${index + 1} überlappen sich.`);
      }
    }
  }
  if (config.operationalModel) {
    const model = config.operationalModel;
    const gateIds = new Set(model.gates.map((entry) => entry.id));
    const resourceGroupIds = new Set(model.resourceGroups.map((entry) => entry.id));
    const aircraftIds = new Set(model.aircraft.map((entry) => entry.id));
    const pilotIds = new Set(model.pilots.map((entry) => entry.id));
    const productIds = new Set(model.products.map((entry) => entry.id));
    for (const [label, ids] of [
      ["Gate", model.gates.map((entry) => entry.id)],
      ["Ressourcengruppe", model.resourceGroups.map((entry) => entry.id)],
      ["Flugzeug", model.aircraft.map((entry) => entry.id)],
      ["Pilot", model.pilots.map((entry) => entry.id)],
      ["Produkt", model.products.map((entry) => entry.id)],
    ] as const) {
      if (new Set(ids).size !== ids.length) {
        errors.push(`${label}-Kennungen müssen eindeutig sein.`);
      }
    }
    if (model.gates.length === 0) errors.push("Der Import enthält kein Gate.");
    if (model.resourceGroups.length === 0)
      errors.push("Der Import enthält keine Ressourcengruppe.");
    if (model.aircraft.length === 0) errors.push("Der Import enthält kein Flugzeug.");
    if (model.products.length === 0) errors.push("Der Import enthält kein Produkt.");
    for (const group of model.resourceGroups) {
      if (!gateIds.has(group.gateId)) {
        errors.push(`Ressourcengruppe ${group.shortCode} verweist auf ein unbekanntes Gate.`);
      }
    }
    for (const entry of model.aircraft) {
      if (!entry.resourceGroupId || !resourceGroupIds.has(entry.resourceGroupId)) {
        errors.push(`Flugzeug ${entry.registration} besitzt keine gültige Ressourcengruppe.`);
      }
    }
    for (const product of model.products) {
      if (!resourceGroupIds.has(product.resourceGroupId) || !gateIds.has(product.gateId)) {
        errors.push(`Produkt ${product.code} besitzt ungültige Gruppen- oder Gate-Verweise.`);
      }
    }
    for (const productId of Object.keys(config.demandByProduct ?? {})) {
      if (!productIds.has(productId)) {
        errors.push(`Die Nachfrage verweist auf ein unbekanntes Produkt (${productId}).`);
      }
    }
    for (const product of model.products) {
      const demand = config.demandByProduct?.[product.id];
      if (!demand) {
        errors.push(`Für Produkt ${product.code} fehlt ein Nachfragemodell.`);
        continue;
      }
      const windows = [...demand.windows].sort(
        (left, right) =>
          left.startOffsetMinutes - right.startOffsetMinutes ||
          left.endOffsetMinutes - right.endOffsetMinutes,
      );
      for (const [index, window] of windows.entries()) {
        if (
          !Number.isInteger(window.startOffsetMinutes) ||
          !Number.isInteger(window.endOffsetMinutes) ||
          window.startOffsetMinutes < 0 ||
          window.endOffsetMinutes <= window.startOffsetMinutes ||
          window.endOffsetMinutes > demandDuration ||
          !Number.isFinite(window.personsPerHour) ||
          window.personsPerHour < 0
        ) {
          errors.push(`Nachfragefenster ${index + 1} für Produkt ${product.code} ist ungültig.`);
        }
        if (index > 0 && (windows[index - 1]?.endOffsetMinutes ?? 0) > window.startOffsetMinutes) {
          errors.push(`Nachfragefenster für Produkt ${product.code} überlappen sich.`);
        }
      }
    }
    const operationIds = new Set<string>();
    for (const operation of config.plannedOperations) {
      if (operationIds.has(operation.key)) {
        errors.push(`Planeintrag ${operation.key} ist doppelt vorhanden.`);
      }
      operationIds.add(operation.key);
      if (operation.unresolvedAfterCurrentRotation) {
        errors.push(
          `Planeintrag ${operation.key} beginnt „nach aktuellem Umlauf“ und muss vor dem Lauf umgewandelt oder ausgeschlossen werden.`,
        );
      }
      const targetValid =
        operation.scopeType === "EVENT"
          ? operation.scopeId === "event"
          : operation.scopeType === "RESOURCE_GROUP"
            ? resourceGroupIds.has(operation.scopeId)
            : operation.scopeType === "AIRCRAFT"
              ? aircraftIds.has(operation.scopeId)
              : pilotIds.has(operation.scopeId);
      if (!targetValid) {
        errors.push(`Planeintrag ${operation.key} verweist auf ein unbekanntes Ziel.`);
      }
      if (
        operation.minimumDurationMinutes < 1 ||
        operation.minimumDurationMinutes > operation.typicalDurationMinutes ||
        operation.typicalDurationMinutes > operation.maximumDurationMinutes
      ) {
        errors.push(`Planeintrag ${operation.key} besitzt eine ungültige Dauer.`);
      }
      if (
        (operation.effectMode === "BLOCKING" &&
          operation.durationMultiplierPercent !== null &&
          operation.durationMultiplierPercent !== undefined) ||
        (operation.effectMode === "SLOWDOWN" &&
          (!Number.isInteger(operation.durationMultiplierPercent) ||
            (operation.durationMultiplierPercent ?? 0) < 110 ||
            (operation.durationMultiplierPercent ?? 0) > 300))
      ) {
        errors.push(`Planeintrag ${operation.key} besitzt einen ungültigen Verzögerungsfaktor.`);
      }
      if (
        operation.startMode === "TIME_WINDOW" &&
        (!operation.earliestStartAt ||
          !operation.latestStartAt ||
          Number.isNaN(Date.parse(operation.earliestStartAt)) ||
          Number.isNaN(Date.parse(operation.latestStartAt)) ||
          Date.parse(operation.earliestStartAt) > Date.parse(operation.latestStartAt))
      ) {
        errors.push(`Planeintrag ${operation.key} besitzt ein ungültiges Startzeitfenster.`);
      }
      if (operation.startMode === "AFTER_CURRENT_ROTATION" && !operation.afterRotationId) {
        errors.push(`Planeintrag ${operation.key} benötigt einen simulierten Bezugsumlauf.`);
      }
    }
    const activeRuleTargets = new Set<string>();
    for (const rule of config.recurringRules ?? []) {
      const identity = `${rule.scopeType}:${rule.scopeId}:${rule.kind}`;
      if (activeRuleTargets.has(identity)) {
        errors.push(`Für ${rule.scopeId} ist die Regelart ${rule.kind} doppelt vorhanden.`);
      }
      activeRuleTargets.add(identity);
      const targetValid =
        rule.scopeType === "AIRCRAFT" ? aircraftIds.has(rule.scopeId) : pilotIds.has(rule.scopeId);
      if (!targetValid) {
        errors.push(`Regel ${rule.key} verweist auf ein unbekanntes Ziel.`);
      }
      if (rule.kind === "REFUELING" && rule.scopeType !== "AIRCRAFT") {
        errors.push(`Regel ${rule.key}: Tanken ist nur für Flugzeuge zulässig.`);
      }
      if (!Number.isInteger(rule.intervalValue) || rule.intervalValue < 1) {
        errors.push(`Regel ${rule.key} besitzt ein ungültiges Intervall.`);
      }
      if (
        rule.minimumDurationMinutes < 1 ||
        rule.minimumDurationMinutes > rule.typicalDurationMinutes ||
        rule.typicalDurationMinutes > rule.maximumDurationMinutes
      ) {
        errors.push(`Regel ${rule.key} besitzt eine ungültige Dauer.`);
      }
    }
  } else if (config.plannedOperations.length > 0) {
    errors.push("Geplante Unterbrechungen benötigen importierte operative Stammdaten.");
  } else if ((config.recurringRules ?? []).length > 0) {
    errors.push("Wiederkehrende Regeln benötigen importierte operative Stammdaten.");
  }
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
