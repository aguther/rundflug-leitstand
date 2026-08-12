import type {
  DispatchCommitmentLevel,
  DispatchDecisionReason,
  DispatchLockedBatchInput,
  DispatchPlan,
  DispatchPlanInput,
  DispatchPlanningLimits,
  DispatchUnplannedReason,
} from "./dispatch-plan";

export type PredictionQuality = "STABLE" | "CHANGING" | "UNCERTAIN";
export type ForecastState =
  | "DISPATCH_WINDOW"
  | "LONG_RANGE_WINDOW"
  | "AFTER_OPERATIONS_END"
  | "UNAVAILABLE";

export const FORECAST_FRESHNESS_MAX_AGE_MINUTES = 5;

export interface ForecastTuningProfile {
  maximumSamples: number;
  referenceWeight: number;
  firstSampleWeight: number;
  recencyWeightIncrement: number;
  referenceOutlierMultiplier: number;
  madMultiplier: number;
  minimumMadToleranceRatio: number;
  stableMinimumSamples: number;
  stableMaximumMeanDeviationMinutes: number;
  stableMarginMinutes: number;
  changingMarginMinutes: number;
}

export const DEFAULT_FORECAST_TUNING_PROFILE: Readonly<ForecastTuningProfile> = Object.freeze({
  maximumSamples: 12,
  referenceWeight: 1,
  firstSampleWeight: 2,
  recencyWeightIncrement: 1,
  referenceOutlierMultiplier: 1.75,
  madMultiplier: 3,
  minimumMadToleranceRatio: 0.5,
  stableMinimumSamples: 5,
  stableMaximumMeanDeviationMinutes: 5,
  stableMarginMinutes: 5,
  changingMarginMinutes: 10,
});

export type ForecastUncertaintyReason =
  | "OPERATION_INTERRUPTED"
  | "EMERGENCY_MODE"
  | "RESOURCE_GROUP_INACTIVE"
  | "NO_ACTIVE_CAPACITY"
  | "NO_FORECAST_CAPACITY"
  | "NO_FITTING_AIRCRAFT"
  | "PLANNED_CONSTRAINT_OVERDUE"
  | "UNPLANNED_RESOURCE_RETURN"
  | "STALE_PREDICTION";

export type ForecastCapacityStatus = "AVAILABLE" | "NO_FORECAST_CAPACITY" | "NO_FITTING_AIRCRAFT";

export interface ForecastFreshnessAssessment {
  quality: PredictionQuality;
  reason: Extract<ForecastUncertaintyReason, "STALE_PREDICTION"> | null;
  ageMinutes: number | null;
}

export interface DurationEstimate {
  expectedMinutes: number;
  lowerMinutes: number;
  upperMinutes: number;
  quality: PredictionQuality;
  sampleCount: number;
}

export type ForecastRotationStatus = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED";

export interface ForecastTimelineEventInput {
  eventId: string;
  now: string;
  plannedOperationsStartAt?: string | null;
  plannedOperationsEndAt?: string | null;
  operationalInterrupted: boolean;
  emergencyMode: boolean;
  plannedBoardingMinutes: number;
  plannedDeboardingMinutes: number;
  plannedBufferMinutes: number;
}

export interface ForecastTimelineRotationInput {
  id: string;
  status: ForecastRotationStatus;
  createdAt: string;
  calledAt: string | null;
  departedAt: string | null;
  landedAt: string | null;
  resourceGroupId: string;
  aircraftId?: string | null;
  pilotId?: string | null;
  resourceGroupStatus: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
  queueSequence: number;
  dispatchGroupIds?: readonly string[];
  dispatchPredecessorMemberIds?: readonly string[];
  productId?: string;
  gateId?: string;
  soldAt?: string;
  attendanceStatus?: "WAITING" | "PRESENT" | "MISSING" | "CLARIFICATION";
  standby?: boolean;
  publicStatus?: DispatchCommitmentLevel;
  confirmedOvertakeCount?: number;
  productServiceDeficit?: number;
  passengerCount?: number;
  referenceDurationMinutes: number;
  productCode: string;
  aircraftType: string | null;
  predictedDepartureAt: string | null;
  predictedLandingAt: string | null;
  predictedCompletionAt: string | null;
  turnaroundProfiles?: readonly ForecastTurnaroundProfileInput[];
  confirmedTurnaroundProfile?: Omit<ForecastTurnaroundProfileInput, "aircraftId"> | null;
  constraints?: readonly ForecastAvailabilityConstraintInput[];
}

export interface ForecastTurnaroundProfileInput {
  aircraftId: string;
  boardingMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
  boardingSource: string;
  deboardingSource: string;
  bufferSource: string;
}

export interface ForecastTimelineDurationSample {
  minutes: number;
  completedAt: string;
  eventId: string;
  productCode: string;
  aircraftType: string | null;
}

export interface ForecastTimelineCapacityInput {
  resourceGroupId: string;
  activeAircraft: number;
  availabilityLanes?: readonly ForecastAvailabilityLaneInput[];
  sharedConstraints?: readonly ForecastAvailabilityConstraintInput[];
  unavailableReason?: Extract<DispatchUnplannedReason, "UNKNOWN_RESOURCE_RETURN"> | null;
}

export interface ForecastAvailabilityConstraintInput {
  id: string;
  earliestStartAt: string;
  latestStartAt: string;
  minimumDurationMinutes: number;
  typicalDurationMinutes: number;
  maximumDurationMinutes: number;
  effectMode?: "BLOCKING" | "SLOWDOWN";
  durationMultiplierPercent?: number | null;
  active?: boolean;
  overdue?: boolean;
}

export interface ForecastAvailabilityLaneInput {
  laneId: string;
  aircraftId: string;
  pilotId?: string | null;
  passengerSeats?: number;
  availableLowerAt: string;
  availableExpectedAt: string;
  availableUpperAt: string;
  constraints?: readonly ForecastAvailabilityConstraintInput[];
  recurringConstraints?: readonly ForecastRecurringConstraintInput[];
}

export interface ForecastRecurringConstraintInput {
  id: string;
  triggerMetric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
  intervalValue: number;
  progressValue: number;
  minimumDurationMinutes: number;
  typicalDurationMinutes: number;
  maximumDurationMinutes: number;
  active?: boolean;
}

export type ForecastDataBasisScope =
  | "REFERENCE_ONLY"
  | "AIRCRAFT_PRODUCT_HISTORY"
  | "PRODUCT_HISTORY";

export interface ForecastTimelineProjection {
  rotationId: string;
  plannedBoardingAt: string;
  plannedDepartureAt: string;
  plannedLandingAt: string;
  plannedCompletionAt: string;
  predictedBoardingAt: string | null;
  predictedDepartureAt: string | null;
  predictedLandingAt: string | null;
  predictedCompletionAt: string | null;
  forecastState: ForecastState;
  extendsBeyondOperationsEnd: boolean;
  overtimeMinutes: number;
  predictionQuality: PredictionQuality;
  predictionLowerMinutes: number | null;
  predictionUpperMinutes: number | null;
  capacityStatus: ForecastCapacityStatus;
  dataBasisScope: ForecastDataBasisScope;
  sampleSize: number;
  dataAgeMinutes: number;
  activeCapacity: number;
  referenceDurationMinutes: number;
  assumedAircraftId: string | null;
  boardingMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
  boardingSource: string;
  deboardingSource: string;
  bufferSource: string;
  uncertaintyReasons: ForecastUncertaintyReason[];
  dispatchPlanId: string | null;
  dispatchPlanRevision: string | null;
  dispatchBatchId: string | null;
  dispatchOrder: number | null;
  dispatchWave: number | null;
  dispatchLaneId: string | null;
  dispatchGroupIds: string[];
  dispatchOccupiedSeats: number | null;
  dispatchAvailableSeats: number | null;
  dispatchCommitmentLevel: DispatchCommitmentLevel | null;
  dispatchDecisionReasons: DispatchDecisionReason[];
  dispatchProjectedOvertakeCount: number;
  dispatchUnplannedReason: DispatchUnplannedReason | null;
}

export interface ForecastTimelinesInput {
  event: ForecastTimelineEventInput;
  rotations: readonly ForecastTimelineRotationInput[];
  durationSamples: readonly ForecastTimelineDurationSample[];
  capacities: readonly ForecastTimelineCapacityInput[];
  tuning?: ForecastTuningProfile;
  previousDispatchPlan?: DispatchPlan | null;
  lockedDispatchBatches?: readonly DispatchLockedBatchInput[];
  dispatchPlanningLimits?: Partial<DispatchPlanningLimits>;
}

export interface ForecastCalculationDiagnostics {
  dispatchInput: DispatchPlanInput;
  dispatchPlan: DispatchPlan;
}

export interface ForecastCalculationResult {
  projections: ForecastTimelineProjection[];
  diagnostics: ForecastCalculationDiagnostics;
}
