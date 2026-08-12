export interface ForecastRecalculationRequest {
  eventId: string;
  triggerEventType: string;
  planningRunId?: string;
  expectedEventVersion?: number;
}

export interface ForecastRecalculationResult {
  planningRunId: string;
  eventVersion: number;
  dispatchPlanRevision: string;
}
