import { evaluateAutomaticPrecalls } from "./forecast-precall-evaluator";
import { ForecastPublicationService } from "./forecast-publication-service";
import { calculateForecastTimelineOnce } from "./forecast-timeline-calculation";
import { ForecastTimelineLoader } from "./forecast-timeline-loader";
import { ForecastTimelineRepository } from "./forecast-timeline-repository";
import type {
  ForecastRecalculationRequest,
  ForecastRecalculationResult,
} from "./forecast-timeline-types";
import {
  completePlanningCapture,
  failPlanningCapture,
  type PreparedPlanningCapture,
  preparePlanningCapture,
} from "./planning-capture";
import type { Env } from "./types";

export type {
  ForecastRecalculationRequest,
  ForecastRecalculationResult,
} from "./forecast-timeline-types";

export class ForecastTimelineService {
  private readonly loader: ForecastTimelineLoader;
  private readonly repository: ForecastTimelineRepository;
  private readonly publication: ForecastPublicationService;

  constructor(
    private readonly env: Env,
    getWebSockets: () => WebSocket[],
    scheduleFollowUp: (request: ForecastRecalculationRequest) => void,
  ) {
    this.loader = new ForecastTimelineLoader(env.DB);
    this.repository = new ForecastTimelineRepository(env);
    this.publication = new ForecastPublicationService(env, getWebSockets, scheduleFollowUp);
  }

  async recalculateForecastTimelines(
    request: ForecastRecalculationRequest,
  ): Promise<ForecastRecalculationResult> {
    const { eventId, triggerEventType } = request;
    const queryNowIso = new Date().toISOString();
    const loaded = await this.loader.load(request, queryNowIso);
    const { event, rotationRows } = loaded;
    const {
      forecastInput,
      adaptiveLeadMinutes,
      now,
      nowIso,
      calculationResult,
      calculationDurationMs,
    } = calculateForecastTimelineOnce(loaded, eventId);
    const projections = calculationResult.projections;
    const planningRunId = request.planningRunId ?? crypto.randomUUID();
    const {
      projectionByRotationId,
      queueEntries: precallQueueEntries,
      candidateByRotationId: precallCandidateByRotationId,
      decisions: precallDecisions,
      candidates: precallCandidates,
    } = evaluateAutomaticPrecalls({
      event,
      rotations: rotationRows.results,
      projections,
      adaptiveLeadMinutes,
      now,
    });
    const statements = this.repository.prepareStatements({
      eventId,
      triggerEventType,
      planningRunId,
      nowIso,
      adaptiveLeadMinutes,
      event,
      rotationRows,
      projectionByRotationId,
      precallCandidateByRotationId,
      precallDecisions,
    });
    let planningCapture: PreparedPlanningCapture | null = null;
    try {
      planningCapture = await preparePlanningCapture({
        env: this.env,
        eventId,
        eventVersion: event.version,
        calculationNow: nowIso,
        capturedAt: new Date().toISOString(),
        triggerEventType,
        forecastInput,
        calculationResult,
        precallInput: precallQueueEntries,
        precallOutput: precallDecisions,
        durationMs: calculationDurationMs,
        runId: planningRunId,
      });
      await this.repository.persist(statements, eventId, precallCandidates, nowIso);
      await this.publication.queuePreparationNotifications(eventId);
      await completePlanningCapture(this.env, planningCapture);
    } catch (error) {
      if (planningCapture) {
        await failPlanningCapture(this.env, planningCapture).catch(() => undefined);
      }
      throw error;
    }
    this.publication.publishForecastUpdated({
      eventId,
      eventVersion: event.version,
      updatedAt: nowIso,
      triggerEventType,
    });
    return {
      planningRunId,
      eventVersion: event.version,
      dispatchPlanRevision: calculationResult.diagnostics.dispatchPlan.revision,
    };
  }
}
