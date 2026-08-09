import { DurableObject } from "cloudflare:workers";
import {
  type CommandEnvelope,
  type CommandResult,
  commandEnvelopeSchema,
  commandResultSchema,
} from "@rundflug/contracts";
import {
  assertMayStageOutageRecoveryEntry,
  assertProductPureSelection,
  assertPublicTicketCode,
  assertRoleMayExecute,
  assertSaleAllowed,
  type ConfirmedOvertakeIncrement,
  calculateConfirmedOvertakeIncrements,
  type DeviceRole,
  DomainRuleError,
  formatBookingGroupLabel,
  type OperationalCommandType,
  planBookingGroupSplit,
  resolveTurnaroundProfile,
  type TicketGroupRecallEndReason,
  transitionRotation,
} from "@rundflug/domain";
import {
  type AnalysisSnapshotCaptureInput,
  type AnalysisSnapshotCaptureResult,
  AnalysisSnapshotCaptureService,
} from "./analysis-snapshot-capture-service";
import { AssistClaimService } from "./assist-claim-service";
import {
  AttendanceCommandService,
  type StoredTicketGroupRecall,
} from "./attendance-command-service";
import {
  loadCommandPreflightReads,
  type PlannedOperationRow,
  plannedOperationExpectation,
  scopedCommandTarget,
} from "./command-preflight";
import { CoordinatorRealtimeService } from "./coordinator-realtime-service";
import { sha256Hex, verifyCredential } from "./crypto";
import { dispatchSegmentOrderSql } from "./dispatch-ordering-sql";
import {
  DispatchRecommendationLeaseService,
  type StoredDispatchRecommendationLease,
} from "./dispatch-recommendation-lease-service";
import { EventAdministrationCommandService } from "./event-administration-command-service";
import { FidsPreferencesCommandService } from "./fids-preferences-command-service";
import { FleetAdministrationCommandService } from "./fleet-administration-command-service";
import {
  type ForecastRecalculationRequest,
  ForecastTimelineService,
} from "./forecast-timeline-service";
import { MasterDataCommandService } from "./master-data-command-service";
import { OperationalControlCommandService } from "./operational-control-command-service";
import { OutageRecoveryCommandService } from "./outage-recovery-command-service";
import { PilotAssignmentCommandService } from "./pilot-assignment-command-service";
import { PlannedOperationCommandService } from "./planned-operation-command-service";
import { ProductSalesCommandService } from "./product-sales-command-service";
import { RecurringOperationalRuleCommandService } from "./recurring-operational-rule-command-service";
import { RotationCorrectionCommandService } from "./rotation-correction-command-service";
import { RotationRecoveryCommandService } from "./rotation-recovery-command-service";
import { rowToSnapshot, safeErrorMessage } from "./snapshot";
import { TicketGroupMutationCommandService } from "./ticket-group-mutation-command-service";
import type { Env, StoredEventRow } from "./types";
import { sendRotationPushNotifications } from "./web-push";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const FORECAST_TICK_INTERVAL_MS = 30_000;
const FORECAST_COMMAND_DEBOUNCE_MS = 150;
const ASSIST_CLAIM_TTL_MS = 30 * 60_000;

export type {
  AnalysisSnapshotCaptureInput,
  AnalysisSnapshotCaptureResult,
} from "./analysis-snapshot-capture-service";

interface QueuedManualForecastRequest {
  input: AnalysisSnapshotCaptureInput;
  resolve: (result: AnalysisSnapshotCaptureResult) => void;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class EventCoordinator extends DurableObject<Env> {
  private commandTail: Promise<void> = Promise.resolve();
  private forecastWork: Promise<void> | null = null;
  private pendingAutomaticForecast: ForecastRecalculationRequest | null = null;
  private readonly manualForecastQueue: QueuedManualForecastRequest[] = [];
  private readonly attendanceCommands = new AttendanceCommandService(
    this.env,
    (result) => this.broadcast(result),
    (promise) => this.ctx.waitUntil(promise),
    (eventId, ticketGroupIds, onlyUnexpiredAt) =>
      this.loadOpenTicketGroupRecalls(eventId, ticketGroupIds, onlyUnexpiredAt),
    (input) => this.ticketGroupRecallClosureStatements(input),
  );
  private readonly ticketGroupMutationCommands = new TicketGroupMutationCommandService(
    this.env,
    (result) => this.broadcast(result),
    (eventId, ticketGroupIds, onlyUnexpiredAt) =>
      this.loadOpenTicketGroupRecalls(eventId, ticketGroupIds, onlyUnexpiredAt),
    (input) => this.ticketGroupRecallClosureStatements(input),
  );
  private readonly eventAdministrationCommands = new EventAdministrationCommandService(
    this.env,
    (result) => this.broadcast(result),
    (promise) => this.ctx.waitUntil(promise),
    () => this.forecastWork,
  );
  private readonly assistClaims = new AssistClaimService(
    this.env,
    (pathname) => this.eventIdFromPath(pathname),
    (eventVersion, eventType) => this.broadcastBoardRefresh(eventVersion, eventType),
  );
  private readonly plannedOperationCommands = new PlannedOperationCommandService(
    this.env,
    (result) => this.broadcast(result),
  );
  private readonly recurringOperationalRuleCommands = new RecurringOperationalRuleCommandService(
    this.env,
    (result) => this.broadcast(result),
  );
  private readonly fleetAdministrationCommands = new FleetAdministrationCommandService(
    this.env,
    (result) => this.broadcast(result),
  );
  private readonly pilotAssignmentCommands = new PilotAssignmentCommandService(this.env, (result) =>
    this.broadcast(result),
  );
  private readonly productSalesCommands = new ProductSalesCommandService(this.env, (result) =>
    this.broadcast(result),
  );
  private readonly masterDataCommands = new MasterDataCommandService(this.env, (result) =>
    this.broadcast(result),
  );
  private readonly operationalControlCommands = new OperationalControlCommandService(
    this.env,
    (result) => this.broadcast(result),
  );
  private readonly outageRecoveryCommands = new OutageRecoveryCommandService(this.env, (result) =>
    this.broadcast(result),
  );
  private readonly rotationCorrectionCommands = new RotationCorrectionCommandService(
    this.env,
    (result) => this.broadcast(result),
  );
  private readonly rotationRecoveryCommands = new RotationRecoveryCommandService(
    this.env,
    (result) => this.broadcast(result),
  );
  private readonly fidsPreferencesCommands = new FidsPreferencesCommandService(this.env);
  private readonly realtime = new CoordinatorRealtimeService(this.ctx);
  private readonly forecastTimelineService = new ForecastTimelineService(
    this.env,
    () => this.realtime.getWebSockets(),
    (request) => {
      this.pendingAutomaticForecast = request;
    },
  );
  private readonly analysisSnapshotCapture = new AnalysisSnapshotCaptureService(
    this.env,
    (request) => this.forecastTimelineService.recalculateForecastTimelines(request),
  );
  private readonly dispatchRecommendationLeases = new DispatchRecommendationLeaseService(
    this.env,
    (promise) => this.ctx.waitUntil(promise),
    () => this.forecastWork,
    (request) => this.forecastTimelineService.recalculateForecastTimelines(request),
    (eventId, triggerEventType) => this.scheduleForecastRecalculation(eventId, triggerEventType),
  );

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const eventId = this.eventIdFromPath(url.pathname);
      if (eventId) await this.ensureForecastAlarm(eventId);
      return this.realtime.openWebSocket();
    }
    if (request.method === "POST" && url.pathname.endsWith("/factory-reset")) {
      this.realtime.closeAllForReset();
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return json({ reset: true });
    }
    if (request.method === "POST" && url.pathname.endsWith("/command")) {
      return this.enqueueCommand(request);
    }
    if (request.method === "PUT" && url.pathname.endsWith("/fids/preferences")) {
      return this.enqueueFidsPreferences(request, url);
    }
    if (
      (request.method === "PUT" || request.method === "DELETE") &&
      url.pathname.includes("/assist-claims/")
    ) {
      return this.assistClaims.handleRequest(request, url);
    }
    if (
      (request.method === "POST" || request.method === "DELETE") &&
      url.pathname.includes("/dispatch-recommendation-leases")
    ) {
      return this.enqueueDispatchRecommendationLease(request, url);
    }
    return json(
      { error: { code: "NOT_FOUND", message: "Durable-Object-Route nicht gefunden." } },
      { status: 404 },
    );
  }

  async captureAnalysisSnapshot(
    input: AnalysisSnapshotCaptureInput,
  ): Promise<AnalysisSnapshotCaptureResult> {
    const result = new Promise<AnalysisSnapshotCaptureResult>((resolve) => {
      this.manualForecastQueue.push({ input, resolve });
    });
    const work = this.ensureForecastRecalculationQueue();
    this.ctx.waitUntil(work);
    return result;
  }

  private enqueueCommand(request: Request): Promise<Response> {
    const enqueuedAt = performance.now();
    const task = this.commandTail.then(async () => {
      const startedAt = performance.now();
      const response = await this.handleCommand(request);
      const completedAt = performance.now();
      const queueDuration = startedAt - enqueuedAt;
      const commandDuration = completedAt - startedAt;
      const headers = new Headers(response.headers);
      const commandTiming = `command-queue;dur=${queueDuration.toFixed(1)}, command;dur=${commandDuration.toFixed(1)}`;
      const phaseTiming = headers.get("server-timing");
      headers.set(
        "server-timing",
        phaseTiming ? `${commandTiming}, ${phaseTiming}` : commandTiming,
      );
      if (queueDuration + commandDuration >= 500) {
        console.log(
          JSON.stringify({
            level: "info",
            code: "SLOW_OPERATIONAL_COMMAND",
            queueDurationMs: Math.round(queueDuration),
            commandDurationMs: Math.round(commandDuration),
          }),
        );
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
    this.commandTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private enqueueFidsPreferences(request: Request, url: URL): Promise<Response> {
    const task = this.commandTail.then(() =>
      this.fidsPreferencesCommands.handleUpdate(request, url),
    );
    this.commandTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private enqueueDispatchRecommendationLease(request: Request, url: URL): Promise<Response> {
    const task = this.commandTail.then(async () => {
      try {
        return await this.dispatchRecommendationLeases.handleRequest(request, url);
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            code: "DISPATCH_RECOMMENDATION_LEASE_FAILED",
            message: error instanceof Error ? error.message : "Unknown dispatch lease failure",
          }),
        );
        return json(
          {
            error: {
              code: "DISPATCH_RECOMMENDATION_LEASE_FAILED",
              message: "Belegungsvorschlag konnte nicht reserviert werden.",
            },
          },
          { status: 500 },
        );
      }
    });
    this.commandTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async alarm(): Promise<void> {
    const task = this.commandTail.then(() => this.handleAlarm());
    this.commandTail = task.then(
      () => undefined,
      () => undefined,
    );
    await task;
  }

  private async handleAlarm(): Promise<void> {
    const eventId = await this.ctx.storage.get<string>("eventId");
    if (!eventId) return;
    try {
      const event = await this.env.DB.prepare(
        `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
                emergency_mode, operational_interrupted, version,
                operational_note, operations_start_at, operations_end_at, sale_opens_at,
                no_show_after_minutes, max_ticket_deferrals, notification_lead_minutes,
                child_reference_weight_kg, normal_reference_weight_kg,
                automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
                precall_min_quality, precall_gate_cooldown_minutes,
                heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
                planned_buffer_minutes, logo_object_key, logo_dark_object_key, updated_at
           FROM operation_days WHERE id = ?1`,
      )
        .bind(eventId)
        .first<StoredEventRow>();
      if (!event) return;
      await this.expireTicketGroupRecalls(event);
      if (event.status === "ACTIVE") {
        await this.scheduleForecastRecalculation(eventId, "AUTOMATIC_FORECAST_TICK");
      }
    } catch (reason: unknown) {
      console.error(
        JSON.stringify({
          level: "error",
          code: "AUTOMATIC_COORDINATOR_TICK_FAILED",
          eventId,
          message: safeErrorMessage(reason),
        }),
      );
    }
    const shouldContinue = await this.env.DB.prepare(
      `SELECT 1 AS pending
         FROM operation_days od
        WHERE od.id = ?1 AND (
          od.status = 'ACTIVE'
          OR EXISTS (
            SELECT 1 FROM ticket_group_recalls recall
             WHERE recall.operation_day_id = od.id AND recall.ended_at IS NULL
          )
        )`,
    )
      .bind(eventId)
      .first<{ pending: number }>();
    if (shouldContinue) {
      await this.ctx.storage.setAlarm(Date.now() + FORECAST_TICK_INTERVAL_MS);
    }
  }

  private eventIdFromPath(pathname: string): string | null {
    const segments = pathname.split("/").filter(Boolean);
    const eventsIndex = segments.indexOf("events");
    return eventsIndex >= 0 ? (segments[eventsIndex + 1] ?? null) : null;
  }

  private async ensureForecastAlarm(eventId: string): Promise<void> {
    await this.ctx.storage.put("eventId", eventId);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + FORECAST_TICK_INTERVAL_MS);
    }
  }

  private async loadOpenTicketGroupRecalls(
    eventId: string,
    ticketGroupIds: readonly string[],
    onlyUnexpiredAt?: string,
  ): Promise<StoredTicketGroupRecall[]> {
    const distinctGroupIds = [...new Set(ticketGroupIds)];
    if (distinctGroupIds.length === 0) return [];
    const groupPlaceholders = distinctGroupIds.map((_, index) => `?${index + 2}`).join(", ");
    const expiryFilter = onlyUnexpiredAt
      ? `AND recall.expires_at > ?${distinctGroupIds.length + 2}`
      : "";
    const rows = await this.env.DB.prepare(
      `SELECT recall.id, recall.ticket_group_id, recall.sequence,
              recall.started_at, recall.expires_at
         FROM ticket_group_recalls recall
        WHERE recall.operation_day_id = ?1
          AND recall.ticket_group_id IN (${groupPlaceholders})
          AND recall.ended_at IS NULL
          ${expiryFilter}
        ORDER BY recall.ticket_group_id`,
    )
      .bind(eventId, ...distinctGroupIds, ...(onlyUnexpiredAt ? [onlyUnexpiredAt] : []))
      .all<StoredTicketGroupRecall>();
    return rows.results;
  }

  private ticketGroupRecallClosureStatements(input: {
    recalls: readonly StoredTicketGroupRecall[];
    eventId: string;
    reason: TicketGroupRecallEndReason;
    deviceId: string;
    now: string;
    event: CommandResult["event"];
  }): D1PreparedStatement[] {
    return input.recalls.flatMap((recall) => {
      const result: CommandResult = {
        accepted: true,
        duplicate: false,
        event: input.event,
        eventType: "TICKET_GROUP_RECALL_CLEARED",
        aggregate: { type: "TICKET_GROUP_RECALL", id: recall.id },
      };
      return [
        this.env.DB.prepare(
          `UPDATE ticket_group_recalls
              SET ended_at = ?1, end_reason = ?2
            WHERE id = ?3 AND operation_day_id = ?4 AND ended_at IS NULL`,
        ).bind(input.now, input.reason, recall.id, input.eventId),
        this.env.DB.prepare(
          `INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
             aggregate_id, aggregate_version, payload_json)
           VALUES (?1, ?2, 'TICKET_GROUP_RECALL_CLEARED', ?3, ?4,
                   'TICKET_GROUP_RECALL', ?5, ?6, ?7)`,
        ).bind(
          crypto.randomUUID(),
          input.eventId,
          input.now,
          input.deviceId,
          recall.id,
          recall.sequence,
          JSON.stringify({
            recallId: recall.id,
            ticketGroupId: recall.ticket_group_id,
            sequence: recall.sequence,
            reason: input.reason,
          }),
        ),
        this.env.DB.prepare(
          `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
           VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)`,
        ).bind(crypto.randomUUID(), input.eventId, JSON.stringify(result), input.now),
      ];
    });
  }

  private async expireTicketGroupRecalls(event: StoredEventRow): Promise<void> {
    const now = new Date().toISOString();
    const due = await this.env.DB.prepare(
      `SELECT id, ticket_group_id, sequence, started_at, expires_at
         FROM ticket_group_recalls
        WHERE operation_day_id = ?1 AND ended_at IS NULL AND expires_at <= ?2
        ORDER BY expires_at, id
        LIMIT 20`,
    )
      .bind(event.id, now)
      .all<StoredTicketGroupRecall>();
    if (due.results.length === 0) return;

    const nextVersion = event.version + 1;
    const nextEvent = rowToSnapshot({ ...event, version: nextVersion, updated_at: now });
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: nextEvent,
      eventType: "TICKET_GROUP_RECALL_EXPIRED",
      aggregate: { type: "OPERATION_DAY", id: event.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE operation_days SET version = ?1, updated_at = ?2
          WHERE id = ?3 AND version = ?4`,
      ).bind(nextVersion, now, event.id, event.version),
      ...this.ticketGroupRecallClosureStatements({
        recalls: due.results,
        eventId: event.id,
        reason: "EXPIRED",
        deviceId: "SYSTEM",
        now,
        event: nextEvent,
      }),
    ]);
    this.broadcast(result);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.realtime.handleMessage(socket, message);
  }

  async webSocketClose(
    _socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    this.realtime.handleClose();
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.realtime.handleError(socket);
  }

  private validateCommandVersion(
    command: CommandEnvelope,
    current: StoredEventRow,
    aggregateVersion: number | null,
  ): Response | null {
    if (command.type === "REORDER_CASHIER_PRODUCTS") {
      const observedEventVersion = command.observedEventVersion ?? command.expectedVersion;
      if (observedEventVersion <= current.version) return null;
      return json(
        {
          error: {
            code: "FUTURE_VERSION",
            message: "Der beobachtete Veranstaltungsstand liegt vor dem Serverstand.",
            currentVersion: current.version,
          },
        },
        { status: 409 },
      );
    }
    const target = scopedCommandTarget(command);
    const preconditions = command.preconditions;
    if (!preconditions) {
      if (current.version === command.expectedVersion) return null;
      return json(
        {
          error: {
            code: "STALE_VERSION",
            message: "Der Zustand wurde zwischenzeitlich geändert.",
            currentVersion: current.version,
          },
        },
        { status: 409 },
      );
    }
    if (
      !target ||
      preconditions.length !== 1 ||
      preconditions[0]?.aggregateType !== target.aggregateType ||
      preconditions[0].aggregateId !== target.aggregateId
    ) {
      return json(
        {
          error: {
            code: "INVALID_PRECONDITION",
            message: "Die Aggregatversion passt nicht zum Kommandoziel.",
          },
        },
        { status: 400 },
      );
    }
    const observedEventVersion = command.observedEventVersion ?? command.expectedVersion;
    if (observedEventVersion > current.version) {
      return json(
        {
          error: {
            code: "FUTURE_VERSION",
            message: "Der beobachtete Veranstaltungsstand liegt vor dem Serverstand.",
            currentVersion: current.version,
          },
        },
        { status: 409 },
      );
    }
    const precondition = preconditions[0];
    if (aggregateVersion === null) {
      return json(
        {
          error: {
            code: "AGGREGATE_NOT_FOUND",
            message: "Das Kommandoziel wurde nicht gefunden.",
          },
        },
        { status: 404 },
      );
    }
    if (aggregateVersion === precondition.expectedVersion) return null;
    return json(
      {
        error: {
          code: "STALE_AGGREGATE_VERSION",
          message: "Dieses Flugzeug oder dieser Umlauf wurde zwischenzeitlich geändert.",
          currentVersion: current.version,
          conflict: {
            aggregateType: precondition.aggregateType,
            aggregateId: precondition.aggregateId,
            currentAggregateVersion: aggregateVersion,
          },
        },
      },
      { status: 409 },
    );
  }

  private async handleCommand(request: Request): Promise<Response> {
    let command: CommandEnvelope;
    try {
      command = commandEnvelopeSchema.parse(await request.json());
    } catch {
      return json(
        { error: { code: "INVALID_COMMAND", message: "Kommando ist formal ungültig." } },
        { status: 400 },
      );
    }

    const eventIdFromPath = new URL(request.url).pathname.split("/").at(-2);
    if (eventIdFromPath !== command.eventId) {
      return json(
        {
          error: {
            code: "EVENT_MISMATCH",
            message: "Event-ID in URL und Kommando stimmen nicht überein.",
          },
        },
        { status: 400 },
      );
    }

    try {
      const prior = await this.env.DB.prepare(
        "SELECT response_json FROM idempotency_receipts WHERE command_id = ?1",
      )
        .bind(command.commandId)
        .first<{ response_json: string }>();
      if (prior) {
        const stored = commandResultSchema.parse(JSON.parse(prior.response_json));
        return json({ ...stored, duplicate: true });
      }

      const operatorRole = request.headers.get("x-operator-role") as DeviceRole | null;
      const operatorDeviceId = request.headers.get("x-operator-device-id");
      let device: { role: DeviceRole; credential_hash: string | null } | null = null;
      if (operatorRole && operatorDeviceId === command.deviceId) {
        device = { role: operatorRole, credential_hash: null };
      } else {
        device = await this.env.DB.prepare(
          `SELECT role, credential_hash
             FROM paired_devices
            WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
        )
          .bind(command.deviceId, command.eventId)
          .first<{ role: DeviceRole; credential_hash: string | null }>();
        if (
          !device ||
          !(await verifyCredential(request.headers.get("x-device-token"), device.credential_hash))
        ) {
          return json(
            { error: { code: "DEVICE_NOT_PAIRED", message: "Sitzung ist nicht berechtigt." } },
            { status: 401 },
          );
        }
        await this.env.DB.prepare("UPDATE paired_devices SET last_seen_at = ?1 WHERE id = ?2")
          .bind(new Date().toISOString(), command.deviceId)
          .run();
      }

      try {
        assertRoleMayExecute(device.role, command.type as OperationalCommandType);
        if (command.type === "STAGE_OUTAGE_RECOVERY") {
          for (const entry of command.payload.entries) {
            assertMayStageOutageRecoveryEntry(device.role, entry.type);
          }
        }
      } catch (reason: unknown) {
        if (reason instanceof DomainRuleError) {
          return json({ error: { code: reason.code, message: reason.message } }, { status: 403 });
        }
        throw reason;
      }

      const operatorAccountId = request.headers.get("x-operator-account-id");
      const commandNow = new Date();
      const preflight = await loadCommandPreflightReads({
        db: this.env.DB,
        command,
        deviceRole: device.role,
        operatorAccountId,
        nowIso: commandNow.toISOString(),
      });
      if (preflight.durationMs >= 50) {
        console.log(
          JSON.stringify({
            level: "info",
            code: "SLOW_COMMAND_PREFLIGHT",
            commandType: command.type,
            durationMs: Math.round(preflight.durationMs),
            batchCount: preflight.batchCount,
            statementCount: preflight.statementCount,
          }),
        );
      }
      const current = preflight.current;
      if (!current) {
        return json(
          { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
          { status: 404 },
        );
      }
      const versionConflict = this.validateCommandVersion(
        command,
        current,
        preflight.aggregateVersion,
      );
      if (versionConflict) return versionConflict;
      const plannedOperationConflict = this.validatePlannedOperationLink(
        command,
        preflight.plannedOperation,
      );
      if (plannedOperationConflict) return plannedOperationConflict;

      const activeOperatorClaim = preflight.activeOperatorClaim;
      // Production commands always carry a session actor. The actor-less branch is retained only
      // for the development integration scaffold, which is already blocked by the public route in
      // every non-development environment.
      if (device.role === "FLIGHT_LINE" && operatorAccountId) {
        if (!activeOperatorClaim) {
          return json(
            {
              error: {
                code: "AIRCRAFT_ASSIST_CLAIM_REQUIRED",
                message: "Die Flugzeugübernahme ist abgelaufen oder wurde extern übernommen.",
              },
            },
            { status: 409 },
          );
        }
        const payload = command.payload as Record<string, unknown>;
        const targetAircraftId =
          typeof payload.aircraftId === "string"
            ? payload.aircraftId
            : preflight.targetRotationAircraftId;
        if (targetAircraftId && targetAircraftId !== activeOperatorClaim.aircraft_id) {
          return json(
            {
              error: {
                code: "AIRCRAFT_ASSIST_CLAIM_MISMATCH",
                message: "Dieses Flugzeug wird nicht mehr von diesem Login betreut.",
              },
            },
            { status: 409 },
          );
        }
      }
      if (operatorAccountId && activeOperatorClaim) {
        await this.env.DB.prepare(
          `UPDATE flight_line_assist_claims
              SET expires_at = ?1, revision = revision + 1
            WHERE operation_day_id = ?2 AND operator_account_id = ?3
              AND revision = ?4 AND expires_at > ?5`,
        )
          .bind(
            new Date(commandNow.getTime() + ASSIST_CLAIM_TTL_MS).toISOString(),
            command.eventId,
            operatorAccountId,
            activeOperatorClaim.revision,
            commandNow.toISOString(),
          )
          .run();
      }

      if (command.type === "SELL_TICKET_GROUP") {
        const salePreflightStartedAt = performance.now();
        const product = await this.env.DB.prepare(
          `SELECT p.id, p.code, p.name, p.resource_group_id, p.gate_id, g.label AS gate_label,
                  p.price_cents, p.sale_enabled, p.sale_closes_at, p.weight_classes_json,
                  rg.status AS resource_group_status,
                  (SELECT COALESCE(MAX(a.passenger_seats), 0)
                     FROM resource_group_memberships m
                     JOIN aircraft a ON a.id = m.aircraft_id
                    WHERE m.operation_day_id = p.operation_day_id
                      AND m.resource_group_id = p.resource_group_id
                      AND m.active_until IS NULL) AS effective_group_capacity
             FROM products p
             JOIN resource_groups rg ON rg.id = p.resource_group_id
             JOIN gates g ON g.id = p.gate_id
            WHERE p.id = ?1 AND p.operation_day_id = ?2`,
        )
          .bind(command.payload.productId, command.eventId)
          .first<{
            id: string;
            code: string;
            name: string;
            resource_group_id: string;
            gate_id: string;
            gate_label: string;
            price_cents: number;
            sale_enabled: number;
            sale_closes_at: string | null;
            weight_classes_json: string;
            resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
            effective_group_capacity: number;
          }>();
        if (!product) {
          return json(
            { error: { code: "PRODUCT_NOT_FOUND", message: "Produkt nicht gefunden." } },
            { status: 404 },
          );
        }
        if (!product.gate_id) {
          return json(
            {
              error: {
                code: "PRODUCT_GATE_REQUIRED",
                message: "Für das Produkt muss vor dem Verkauf ein Gate konfiguriert sein.",
              },
            },
            { status: 409 },
          );
        }
        if (current.sale_opens_at && Date.parse(current.sale_opens_at) > Date.now()) {
          return json(
            {
              error: {
                code: "SALE_NOT_OPEN",
                message: "Der konfigurierte Verkaufsbeginn ist noch nicht erreicht.",
              },
            },
            { status: 409 },
          );
        }
        try {
          assertSaleAllowed({
            eventStatus: current.status,
            productSaleEnabled: product.sale_enabled === 1,
            resourceGroupStatus: product.resource_group_status,
            emergencyMode: current.emergency_mode === 1,
            eventInterrupted: current.operational_interrupted === 1,
            saleClosingReached:
              product.sale_closes_at !== null && Date.parse(product.sale_closes_at) <= Date.now(),
          });
        } catch (reason: unknown) {
          if (reason instanceof DomainRuleError) {
            return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
          }
          throw reason;
        }
        if (!current.operations_end_at) {
          return json(
            {
              error: {
                code: "OPERATING_END_REQUIRED",
                message: "Betriebsende muss vor dem Verkauf konfiguriert sein.",
              },
            },
            { status: 409 },
          );
        }
        const effectiveGroupCapacity = product.effective_group_capacity;
        if (effectiveGroupCapacity === 0) {
          return json(
            {
              error: {
                code: "SALE_BLOCKED_NO_AIRCRAFT",
                message: "Der Ressourcengruppe ist kein aktives Flugzeug zugeordnet.",
              },
            },
            { status: 409 },
          );
        }
        let splitPlan: ReturnType<typeof planBookingGroupSplit>;
        try {
          splitPlan = planBookingGroupSplit({
            groupSize: command.payload.publicTicketCodes.length,
            referenceCapacity: effectiveGroupCapacity,
            splitAcknowledged: command.payload.oversizeSplitAcknowledged,
          });
        } catch (reason: unknown) {
          if (reason instanceof DomainRuleError) {
            return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
          }
          throw reason;
        }
        const requiredFlightGroupCount = splitPlan.slotSizes.length;

        const normalizedCodes = command.payload.publicTicketCodes.map(assertPublicTicketCode);
        const normalizedGroupCode = assertPublicTicketCode(
          command.payload.publicGroupCode ?? normalizedCodes[0] ?? "",
        );
        if (
          command.payload.publicGroupCode !== undefined &&
          normalizedCodes.includes(normalizedGroupCode)
        ) {
          return json(
            {
              error: {
                code: "DUPLICATE_GROUP_CODE",
                message: "Gruppen- und interne Ticketcodes müssen verschieden sein.",
              },
            },
            { status: 409 },
          );
        }
        if (new Set(normalizedCodes).size !== normalizedCodes.length) {
          return json(
            {
              error: {
                code: "DUPLICATE_TICKET_CODE",
                message: "Ticketcodes müssen eindeutig sein.",
              },
            },
            { status: 409 },
          );
        }
        const allowedWeightClasses = JSON.parse(product.weight_classes_json) as Array<
          "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
        >;
        const ticketDetailsProvided = command.payload.ticketDetails !== undefined;
        const ticketDetails =
          command.payload.ticketDetails ??
          normalizedCodes.map(() => ({
            weightClass: "NOT_CAPTURED" as const,
            individualWeightKg: null,
          }));
        if (ticketDetails.length !== normalizedCodes.length) {
          return json(
            {
              error: {
                code: "TICKET_DETAILS_COUNT_MISMATCH",
                message: "Für jedes Ticket muss genau eine Gewichtsklasse angegeben werden.",
              },
            },
            { status: 409 },
          );
        }
        if (
          ticketDetailsProvided &&
          ticketDetails.some(
            (detail) =>
              !allowedWeightClasses.includes(detail.weightClass) ||
              (detail.weightClass === "INDIVIDUAL" && detail.individualWeightKg === null) ||
              (detail.weightClass !== "INDIVIDUAL" && detail.individualWeightKg !== null),
          )
        ) {
          return json(
            {
              error: {
                code: "WEIGHT_CLASS_NOT_ALLOWED",
                message: "Gewichtsklasse oder individuelle Kilogrammangabe ist nicht zulässig.",
              },
            },
            { status: 409 },
          );
        }
        const [groupCodeHash, ...hashes] = await Promise.all(
          [normalizedGroupCode, ...normalizedCodes].map(sha256Hex),
        );
        const publicCodeHashes = [groupCodeHash, ...hashes];
        const hashPlaceholders = publicCodeHashes.map(() => "?").join(", ");
        const saleState = await this.env.DB.prepare(
          `SELECT
             EXISTS(
               SELECT 1 FROM ticket_groups
                WHERE public_status_code_hash IN (${hashPlaceholders})
               UNION ALL
               SELECT 1 FROM tickets
                WHERE public_code_hash IN (${hashPlaceholders})
             ) AS public_code_exists,
             (SELECT COALESCE(MAX(tg.queue_sequence), 0) + 1
                FROM ticket_groups tg
                JOIN products p ON p.id = tg.product_id
               WHERE tg.operation_day_id = ? AND p.resource_group_id = ?) AS next_queue_sequence,
             (SELECT COALESCE(MAX(communication_number), 100) + 1
                FROM flight_groups
               WHERE operation_day_id = ? AND resource_group_id = ?) AS next_flight_number,
             (SELECT COALESCE(MAX(communication_number), 100) + 1
                FROM ticket_groups
               WHERE operation_day_id = ?) AS next_ticket_number`,
        )
          .bind(
            ...publicCodeHashes,
            ...publicCodeHashes,
            command.eventId,
            product.resource_group_id,
            command.eventId,
            product.resource_group_id,
            command.eventId,
          )
          .first<{
            public_code_exists: number;
            next_queue_sequence: number;
            next_flight_number: number;
            next_ticket_number: number;
          }>();
        if (saleState?.public_code_exists) {
          return json(
            {
              error: {
                code: "DUPLICATE_GROUP_CODE",
                message: "Einer der öffentlichen Codes wurde bereits verwendet.",
              },
            },
            { status: 409 },
          );
        }
        const splitAcrossFlightGroups = splitPlan.splitAcknowledged;
        const now = new Date().toISOString();
        const nextVersion = current.version + 1;
        const ticketGroupId = crypto.randomUUID();
        const ticketCommunicationNumber = saleState?.next_ticket_number ?? 101;
        const slots = Array.from({ length: requiredFlightGroupCount }, (_, index) => ({
          flightGroupId: crypto.randomUUID(),
          rotationId: crypto.randomUUID(),
          communicationNumber: (saleState?.next_flight_number ?? 101) + index,
          bookingSegmentOrder: index + 1,
        }));
        const primarySlot = slots[0];
        if (!primarySlot) throw new Error("Mindestens ein Fluggruppen-Slot wurde erwartet.");
        const ticketIds = hashes.map(() => crypto.randomUUID());
        const eventId = crypto.randomUUID();
        const result: CommandResult = {
          accepted: true,
          duplicate: false,
          event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
          eventType: "TICKET_GROUP_SOLD",
          aggregate: {
            type: "TICKET_GROUP",
            id: ticketGroupId,
            relatedRotationId: primarySlot.rotationId,
          },
          saleReceipt: {
            ticketGroupId,
            eventName: current.name,
            productName: product.name,
            gateLabel: product.gate_label,
            communicationLabel: formatBookingGroupLabel(product.code, ticketCommunicationNumber),
            code: normalizedGroupCode,
            groupSize: normalizedCodes.length,
          },
        };
        const stateChangeResult: CommandResult = {
          accepted: result.accepted,
          duplicate: result.duplicate,
          event: result.event,
          eventType: result.eventType,
          aggregate: result.aggregate,
        };
        const statements = [
          this.env.DB.prepare(
            "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
          ).bind(nextVersion, now, command.eventId, current.version),
          this.env.DB.prepare(`INSERT INTO ticket_groups
            (id, operation_day_id, product_id, queue_sequence, communication_number, standby,
             status, sold_at, version, public_status_code_hash, public_status_code,
             sold_by_operator_account_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'QUEUED', ?7, 0, ?8, ?9, ?10)`).bind(
            ticketGroupId,
            command.eventId,
            product.id,
            saleState?.next_queue_sequence ?? 1,
            ticketCommunicationNumber,
            command.payload.standby ? 1 : 0,
            now,
            groupCodeHash,
            normalizedGroupCode,
            operatorAccountId,
          ),
          ...slots.flatMap((slot) => [
            this.env.DB.prepare(`INSERT INTO flight_groups
                  (id, operation_day_id, resource_group_id, product_id, communication_number,
                   status, version, created_at, updated_at)
                  VALUES (?1, ?2, ?3, ?4, ?5, 'DRAFT', 0, ?6, ?6)`).bind(
              slot.flightGroupId,
              command.eventId,
              product.resource_group_id,
              product.id,
              slot.communicationNumber,
              now,
            ),
            this.env.DB.prepare(`INSERT INTO rotations
                  (id, operation_day_id, flight_group_id, gate_id, booking_segment_order,
                   status, version, created_at, updated_at)
                  VALUES (?1, ?2, ?3, ?4, ?5, 'DRAFT', 0, ?6, ?6)`).bind(
              slot.rotationId,
              command.eventId,
              slot.flightGroupId,
              product.gate_id,
              slot.bookingSegmentOrder,
              now,
            ),
          ]),
          ...hashes.flatMap((hash, index) => {
            const slotIndex = splitAcrossFlightGroups
              ? Math.floor(index / effectiveGroupCapacity)
              : 0;
            const ticketSlot = slots[slotIndex];
            if (!ticketSlot) throw new Error("Fluggruppen-Slot für Ticket fehlt.");
            return [
              this.env.DB.prepare(`INSERT INTO tickets
                (id, ticket_group_id, public_code_hash, public_code, status, weight_class,
                 individual_weight_kg, payment_status, payment_method, price_cents, created_at)
                VALUES (?1, ?2, ?3, ?4, 'QUEUED', ?5, ?6, ?7, ?8, ?9, ?10)`).bind(
                ticketIds[index],
                ticketGroupId,
                hash,
                normalizedCodes[index],
                ticketDetails[index]?.weightClass,
                ticketDetails[index]?.individualWeightKg,
                command.payload.paymentStatus,
                command.payload.paymentMethod,
                product.price_cents,
                now,
              ),
              this.env.DB.prepare(
                "INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at) VALUES (?1, ?2, ?3)",
              ).bind(ticketSlot.rotationId, ticketIds[index], now),
            ];
          }),
          this.env.DB.prepare(`INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type, aggregate_id, aggregate_version, payload_json)
            VALUES (?1, ?2, 'TICKET_GROUP_SOLD', ?3, ?4, 'TICKET_GROUP', ?5, 0, ?6)`).bind(
            eventId,
            command.eventId,
            now,
            command.deviceId,
            ticketGroupId,
            JSON.stringify({
              ticketGroupId,
              flightGroupId: primarySlot.flightGroupId,
              rotationId: primarySlot.rotationId,
              flightGroupIds: slots.map((slot) => slot.flightGroupId),
              rotationIds: slots.map((slot) => slot.rotationId),
              ticketCount: ticketIds.length,
              productId: product.id,
              weightClasses: ticketDetails.map((detail) => detail.weightClass),
              paymentStatus: command.payload.paymentStatus,
              paymentMethod: command.payload.paymentMethod,
              joinedExistingFlightGroup: false,
              oversizeSplitAcknowledged: splitPlan.splitAcknowledged,
              slotSizes: splitPlan.slotSizes,
            }),
          ),
          this.env.DB.prepare(`INSERT INTO idempotency_receipts
            (command_id, operation_day_id, device_id, command_type, received_at, response_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
            command.commandId,
            command.eventId,
            command.deviceId,
            command.type,
            now,
            JSON.stringify(result),
          ),
          this.env.DB.prepare(
            "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
          ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(stateChangeResult), now),
        ];
        const salePersistStartedAt = performance.now();
        await this.env.DB.batch(statements);
        const salePersistCompletedAt = performance.now();
        this.broadcast(result);
        const response = json(result);
        response.headers.set(
          "server-timing",
          `sale-preflight;dur=${(salePersistStartedAt - salePreflightStartedAt).toFixed(1)}, sale-persist;dur=${(salePersistCompletedAt - salePersistStartedAt).toFixed(1)}`,
        );
        return response;
      }

      if (command.type !== "SET_OPERATIONAL_NOTE") {
        if (command.type === "STAGE_OUTAGE_RECOVERY") {
          return this.outageRecoveryCommands.handleStageOutageRecovery(command, current);
        }
        if (command.type === "APPROVE_OUTAGE_RECOVERY") {
          return this.outageRecoveryCommands.handleApproveOutageRecovery(command, current);
        }
        if (command.type === "APPLY_OUTAGE_RECOVERY") {
          return this.outageRecoveryCommands.handleApplyOutageRecovery(command, current);
        }
        if (command.type === "ASSIGN_AIRCRAFT_PILOT") {
          return this.pilotAssignmentCommands.handleAircraftPilotAssignment(command, current);
        }
        if (
          command.type === "UPSERT_PLANNED_OPERATION" ||
          command.type === "CANCEL_PLANNED_OPERATION" ||
          command.type === "SET_PLANNED_SLOWDOWN_ACTIVE"
        ) {
          return this.plannedOperationCommands.handlePlannedOperation(
            command,
            current,
            device.role,
          );
        }
        if (
          command.type === "UPSERT_RECURRING_OPERATIONAL_RULE" ||
          command.type === "DISABLE_RECURRING_OPERATIONAL_RULE"
        ) {
          return this.recurringOperationalRuleCommands.handleRecurringOperationalRule(
            command,
            current,
          );
        }
        if (
          command.type === "SET_AIRCRAFT_OPERATIONAL_STATE" ||
          command.type === "SCHEDULE_AIRCRAFT_REFUEL" ||
          command.type === "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD" ||
          command.type === "SET_PILOT_PAUSE" ||
          command.type === "UPSERT_PILOT"
        ) {
          return this.fleetAdministrationCommands.handleFleetAdministration(command, current);
        }
        if (command.type === "PAIR_DEVICE" || command.type === "REVOKE_DEVICE") {
          return this.eventAdministrationCommands.handleDevices(command, current);
        }
        if (command.type === "CONFIGURE_PRODUCT_SALES") {
          return this.productSalesCommands.handleProductSalesConfiguration(command, current);
        }
        if (command.type === "CONFIGURE_EVENT_PARAMETERS") {
          return this.eventAdministrationCommands.handleParameters(command, current);
        }
        if (command.type === "REORDER_CASHIER_PRODUCTS") {
          return this.masterDataCommands.handleCashierProductReorder(command, current);
        }
        if (command.type === "SET_EVENT_LIFECYCLE") {
          return this.eventAdministrationCommands.handleLifecycle(command, current);
        }
        if (command.type === "DELETE_MASTER_DATA") {
          return this.masterDataCommands.handleMasterDataDeletion(command, current);
        }
        if (command.type === "UPSERT_GATE" || command.type === "UPSERT_PRODUCT") {
          return this.masterDataCommands.handleMasterData(command, current);
        }
        if (
          command.type === "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE" ||
          command.type === "DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE"
        ) {
          return this.masterDataCommands.handleAircraftProductTurnaroundOverride(command, current);
        }
        if (
          command.type === "UPSERT_RESOURCE_GROUP" ||
          command.type === "UPSERT_AIRCRAFT" ||
          command.type === "ASSIGN_AIRCRAFT_RESOURCE_GROUP"
        ) {
          return this.masterDataCommands.handleResourceAndAircraftMasterData(command, current);
        }
        if (
          command.type === "TRIGGER_EMERGENCY" ||
          command.type === "CLEAR_EMERGENCY" ||
          command.type === "SET_EVENT_INTERRUPTION" ||
          command.type === "SET_RESOURCE_GROUP_STATUS" ||
          command.type === "SET_RESOURCE_GROUP_NOTICE"
        ) {
          return this.operationalControlCommands.handle(command, current);
        }
        if (command.type === "REVOKE_CALL") {
          return this.rotationRecoveryCommands.handleRevokeCall(command, current);
        }
        if (command.type === "ABORT_ROTATION") {
          return this.rotationRecoveryCommands.handleAbortRotation(command, current);
        }
        if (command.type === "ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE") {
          return this.rotationRecoveryCommands.handleTechnicalRotationAbort(command, current);
        }
        if (command.type === "SET_TICKET_ATTENDANCE") {
          return this.attendanceCommands.handleTicketAttendance(command, current);
        }
        if (
          command.type === "MARK_TICKET_NO_SHOW" ||
          command.type === "CONFIRM_ATTENDANCE_DECISION"
        ) {
          return this.attendanceCommands.handleAttendanceException(command, current);
        }
        if (command.type === "SET_ROTATION_NOTE") {
          return this.handleRotationNote(command, current);
        }
        if (command.type === "SET_ROTATION_CAPACITY") {
          return this.rotationCorrectionCommands.handleRotationCapacity(command, current);
        }
        if (command.type === "MOVE_TICKET_GROUP") {
          return this.rotationCorrectionCommands.handleManualTicketGroupMove(command, current);
        }
        if (command.type === "CORRECT_ROTATION_MANIFEST") {
          return this.rotationCorrectionCommands.handleRotationManifestCorrection(command, current);
        }
        if (
          command.type === "CANCEL_TICKET_GROUP" ||
          command.type === "DEFER_TICKET_GROUP" ||
          command.type === "MARK_NO_SHOW"
        ) {
          return this.ticketGroupMutationCommands.handleTicketGroupMutation(command, current);
        }
        if (
          command.type === "CALL_NEXT" ||
          command.type === "MARK_OFF_BLOCK" ||
          command.type === "MARK_ON_BLOCK" ||
          command.type === "COMPLETE_TURNAROUND" ||
          command.type === "CANCEL_ROTATION"
        ) {
          if (command.type === "CALL_NEXT" && current.status !== "ACTIVE") {
            return json(
              {
                error: {
                  code: "CALL_BLOCKED_EVENT_STATUS",
                  message: "Neue Aufrufe sind nur bei aktiver Veranstaltung zulässig.",
                },
              },
              { status: 409 },
            );
          }
          if (command.type === "CALL_NEXT" && current.emergency_mode === 1) {
            return json(
              {
                error: {
                  code: "CALL_BLOCKED_EMERGENCY",
                  message: "Neue Aufrufe sind im Notfallmodus gesperrt.",
                },
              },
              { status: 409 },
            );
          }
          if (command.type === "CALL_NEXT" && current.operational_interrupted === 1) {
            return json(
              {
                error: {
                  code: "CALL_BLOCKED_INTERRUPTION",
                  message: "Neue Aufrufe sind während der Betriebsunterbrechung gesperrt.",
                },
              },
              { status: 409 },
            );
          }
          return this.handleRotationTransition(command, current, operatorAccountId);
        }
        if (command.type === "SET_TICKET_GROUP_ATTENDANCE") {
          return this.attendanceCommands.handleTicketGroupAttendance(command, current);
        }
        if (
          command.type === "START_TICKET_GROUP_RECALL" ||
          command.type === "CLEAR_TICKET_GROUP_RECALL"
        ) {
          return this.attendanceCommands.handleTicketGroupRecall(command, current);
        }
        if (
          command.type === "MARK_TICKET_GROUP_MISSING" ||
          command.type === "RESTORE_TICKET_GROUP_TO_QUEUE" ||
          command.type === "RECALL_TICKET_GROUP"
        ) {
          return this.attendanceCommands.handleTicketGroupPresence(command, current);
        }
        return json(
          { error: { code: "COMMAND_NOT_IMPLEMENTED", message: "Kommando nicht implementiert." } },
          { status: 501 },
        );
      }

      const nextVersion = current.version + 1;
      const persistedAt = new Date().toISOString();
      const eventRecordId = crypto.randomUUID();
      const outboxId = crypto.randomUUID();
      const nextSnapshot = rowToSnapshot({
        ...current,
        version: nextVersion,
        operational_note: command.payload.note,
        updated_at: persistedAt,
      });
      const result: CommandResult = {
        accepted: true,
        duplicate: false,
        event: nextSnapshot,
        eventType: "OPERATIONAL_NOTE_SET",
      };

      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE operation_days
              SET operational_note = ?1, version = ?2, updated_at = ?3
            WHERE id = ?4 AND version = ?5`,
        ).bind(command.payload.note, nextVersion, persistedAt, command.eventId, current.version),
        this.env.DB.prepare(
          `INSERT INTO operational_events
             (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
              aggregate_id, aggregate_version, payload_json)
           VALUES (?1, ?2, ?3, ?4, ?5, 'OPERATION_DAY', ?2, ?6, ?7)`,
        ).bind(
          eventRecordId,
          command.eventId,
          "OPERATIONAL_NOTE_SET",
          persistedAt,
          command.deviceId,
          nextVersion,
          JSON.stringify({ note: command.payload.note }),
        ),
        this.env.DB.prepare(
          `INSERT INTO idempotency_receipts
             (command_id, operation_day_id, device_id, command_type, received_at, response_json)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ).bind(
          command.commandId,
          command.eventId,
          command.deviceId,
          command.type,
          persistedAt,
          JSON.stringify(result),
        ),
        this.env.DB.prepare(
          `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
           VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)`,
        ).bind(outboxId, command.eventId, JSON.stringify(result), persistedAt),
      ]);

      this.broadcast(result);
      return json(result, { status: 200 });
    } catch (reason: unknown) {
      console.error(
        JSON.stringify({
          level: "error",
          code: "COMMAND_PROCESSING_FAILED",
          message: safeErrorMessage(reason),
          eventId: command.eventId,
          commandType: command.type,
        }),
      );
      return json(
        { error: { code: "INTERNAL_ERROR", message: "Kommando konnte nicht verarbeitet werden." } },
        { status: 500 },
      );
    }
  }

  private validatePlannedOperationLink(
    command: CommandEnvelope,
    plan: PlannedOperationRow | null,
  ): Response | null {
    const expectation = plannedOperationExpectation(command);
    if (expectation.kind === "none") return null;
    if (expectation.kind === "unsupported") {
      return json(
        {
          error: {
            code: "PLANNED_OPERATION_LINK_NOT_SUPPORTED",
            message: "Dieses Kommando kann nicht mit einem Planeintrag verknüpft werden.",
          },
        },
        { status: 409 },
      );
    }
    if (!plan) {
      return json(
        { error: { code: "PLANNED_OPERATION_NOT_FOUND", message: "Planeintrag nicht gefunden." } },
        { status: 404 },
      );
    }
    if (plan.effect_mode !== "BLOCKING") {
      return json(
        {
          error: {
            code: "PLANNED_OPERATION_EFFECT_MISMATCH",
            message: "Ein verzögerter Betrieb darf keinen Ressourcenstopp auslösen.",
          },
        },
        { status: 409 },
      );
    }
    if (plan.scope_type !== expectation.scopeType || plan.scope_id !== expectation.scopeId) {
      return json(
        {
          error: {
            code: "PLANNED_OPERATION_SCOPE_MISMATCH",
            message: "Planeintrag und operatives Ziel stimmen nicht überein.",
          },
        },
        { status: 409 },
      );
    }
    if (
      (expectation.activating && plan.status !== "PLANNED") ||
      (!expectation.activating && plan.status !== "ACTIVE")
    ) {
      return json(
        {
          error: {
            code: "PLANNED_OPERATION_STATUS_MISMATCH",
            message: "Der Planeintrag ist für diese Bestätigung nicht im passenden Zustand.",
          },
        },
        { status: 409 },
      );
    }
    return null;
  }

  private broadcast(result: CommandResult): void {
    this.ctx.waitUntil(this.ensureForecastAlarm(result.event.eventId));
    this.ctx.waitUntil(this.scheduleForecastRecalculation(result.event.eventId, result.eventType));
    this.realtime.broadcastStateChanged(result.event.version);
  }

  private scheduleForecastRecalculation(eventId: string, triggerEventType: string): Promise<void> {
    this.pendingAutomaticForecast = { eventId, triggerEventType };
    return this.ensureForecastRecalculationQueue();
  }

  private ensureForecastRecalculationQueue(): Promise<void> {
    if (this.forecastWork) return this.forecastWork;
    const work = this.runForecastRecalculationQueue();
    this.forecastWork = work;
    return work;
  }

  private async runForecastRecalculationQueue(): Promise<void> {
    try {
      if (this.manualForecastQueue.length === 0) {
        await scheduler.wait(FORECAST_COMMAND_DEBOUNCE_MS);
      }
      while (this.manualForecastQueue.length > 0 || this.pendingAutomaticForecast) {
        const manual = this.manualForecastQueue.shift();
        if (manual) {
          try {
            manual.resolve(await this.analysisSnapshotCapture.capture(manual.input));
          } catch (reason: unknown) {
            console.error(
              JSON.stringify({
                level: "error",
                code: "ANALYSIS_SNAPSHOT_CAPTURE_FAILED",
                eventId: manual.input.eventId,
                message: safeErrorMessage(reason),
              }),
            );
            manual.resolve({ ok: false, code: "ANALYSIS_SNAPSHOT_CAPTURE_FAILED" });
          }
          continue;
        }
        const requested = this.pendingAutomaticForecast;
        this.pendingAutomaticForecast = null;
        if (!requested) continue;
        try {
          await this.forecastTimelineService.recalculateForecastTimelines(requested);
        } catch (reason: unknown) {
          console.error(
            JSON.stringify({
              level: "error",
              code: "FORECAST_RECALCULATION_FAILED",
              eventId: requested.eventId,
              message: safeErrorMessage(reason),
            }),
          );
        }
        if (this.manualForecastQueue.length === 0 && this.pendingAutomaticForecast) {
          await scheduler.wait(FORECAST_COMMAND_DEBOUNCE_MS);
        }
      }
    } finally {
      this.forecastWork = null;
    }
  }

  private broadcastBoardRefresh(eventVersion: number, eventType: string): void {
    this.realtime.broadcastStateChanged(eventVersion, eventType);
  }

  private async handleRotationNote(
    command: Extract<CommandEnvelope, { type: "SET_ROTATION_NOTE" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      "SELECT id, version FROM rotations WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{ id: string; version: number }>();
    if (!rotation) {
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." } },
        { status: 404 },
      );
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "ROTATION_NOTE_SET",
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        "UPDATE rotations SET operational_note = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(command.payload.note, now, rotation.id, rotation.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'ROTATION_NOTE_SET', ?3, ?4, 'ROTATION', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({ note: command.payload.note, reason: command.payload.reason }),
      ),
      this.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        command.commandId,
        command.eventId,
        command.deviceId,
        command.type,
        now,
        JSON.stringify(result),
      ),
      this.env.DB.prepare(
        "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), now),
    ]);
    this.broadcast(result);
    return json(result);
  }

  private async handleRotationTransition(
    command: Extract<
      CommandEnvelope,
      {
        type:
          | "CALL_NEXT"
          | "MARK_OFF_BLOCK"
          | "MARK_ON_BLOCK"
          | "COMPLETE_TURNAROUND"
          | "CANCEL_ROTATION";
      }
    >,
    current: StoredEventRow,
    operatorAccountId: string | null,
  ): Promise<Response> {
    const primaryAssignment =
      command.type === "CALL_NEXT"
        ? await this.env.DB.prepare(
            `SELECT r.id AS rotation_id
               FROM ticket_groups tg
               JOIN tickets t ON t.ticket_group_id = tg.id
               JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
               JOIN rotations r ON r.id = rt.rotation_id
               JOIN flight_groups fg ON fg.id = r.flight_group_id
              WHERE tg.operation_day_id = ?1 AND tg.id = ?2
                AND r.status = 'DRAFT'
              GROUP BY r.id, fg.queue_position
              ORDER BY ${dispatchSegmentOrderSql("r", "fg")}, r.created_at, r.id
              LIMIT 1`,
          )
            .bind(command.eventId, command.payload.ticketGroupIds[0])
            .first<{ rotation_id: string }>()
        : null;
    const rotationId =
      command.type === "CALL_NEXT" ? primaryAssignment?.rotation_id : command.payload.rotationId;
    if (!rotationId) {
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Keine ausgewählte Gruppe gefunden." } },
        { status: 404 },
      );
    }
    const rotation = await this.env.DB.prepare(
      `SELECT r.id, r.status, r.version, r.aircraft_id, r.pilot_id, r.called_at,
              r.forecast_assumed_aircraft_id, r.dispatch_plan_revision,
              r.dispatch_batch_id, r.dispatch_group_ids_json,
              (SELECT snapshot.operation_day_version
                 FROM forecast_snapshots snapshot
                WHERE snapshot.rotation_id = r.id
                  AND snapshot.dispatch_plan_revision = r.dispatch_plan_revision
                ORDER BY snapshot.captured_at DESC, snapshot.id DESC
                LIMIT 1) AS dispatch_operation_day_version,
              fg.product_id AS flight_group_product_id, rg.status AS resource_group_status
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rg ON rg.id = fg.resource_group_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2`,
    )
      .bind(rotationId, command.eventId)
      .first<{
        id: string;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED" | "CANCELED";
        version: number;
        aircraft_id: string | null;
        pilot_id: string | null;
        called_at: string | null;
        forecast_assumed_aircraft_id: string | null;
        dispatch_plan_revision: string | null;
        dispatch_batch_id: string | null;
        dispatch_group_ids_json: string;
        dispatch_operation_day_version: number | null;
        flight_group_product_id: string | null;
        resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
      }>();
    if (!rotation)
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." } },
        { status: 404 },
      );
    let selectedGroups: Array<{
      ticket_group_id: string;
      rotation_id: string;
      resource_group_id: string;
      product_id: string;
      queue_sequence: number;
      ticket_count: number;
    }> = [];
    let skippedEarlierTicketGroupIds: string[] = [];
    let acceptedDispatchRecommendation = false;
    let acceptedDispatchRecommendationLease: StoredDispatchRecommendationLease | null = null;
    let manualOverrideLeases: StoredDispatchRecommendationLease[] = [];
    let manualOverrideReason: string | null = null;
    let confirmedOvertakeIncrements: ConfirmedOvertakeIncrement[] = [];
    let confirmedTurnaroundProductId: string | null = null;
    let confirmedTurnaroundProfile: ReturnType<typeof resolveTurnaroundProfile> | null = null;
    if (command.type === "CALL_NEXT") {
      if (rotation.resource_group_status !== "ACTIVE") {
        return json(
          {
            error: {
              code: "RESOURCE_GROUP_NOT_ACTIVE",
              message: "Ressourcengruppe ist für neue Aufrufe nicht aktiv.",
            },
          },
          { status: 409 },
        );
      }
      const distinctGroupIds = [...new Set(command.payload.ticketGroupIds)];
      if (distinctGroupIds.length !== command.payload.ticketGroupIds.length) {
        return json(
          {
            error: {
              code: "DUPLICATE_TICKET_GROUP",
              message: "Eine Gruppe wurde mehrfach gewählt.",
            },
          },
          { status: 400 },
        );
      }
      const placeholders = distinctGroupIds.map((_, index) => `?${index + 2}`).join(", ");
      const groupResult = await this.env.DB.prepare(
        `SELECT tg.id AS ticket_group_id, r.id AS rotation_id,
                tg.product_id, tg.queue_sequence, p.resource_group_id, COUNT(t.id) AS ticket_count
           FROM ticket_groups tg
           JOIN products p ON p.id = tg.product_id
           JOIN tickets t ON t.ticket_group_id = tg.id
           JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
           JOIN rotations r ON r.id = rt.rotation_id
           JOIN flight_groups fg ON fg.id = r.flight_group_id
          WHERE tg.operation_day_id = ?1 AND tg.id IN (${placeholders})
            AND tg.status IN ('QUEUED', 'PRESENT')
            AND r.status = 'DRAFT'
            AND r.id = (
              SELECT candidate_rotation.id
                FROM tickets candidate_ticket
                JOIN rotation_tickets candidate_assignment
                  ON candidate_assignment.ticket_id = candidate_ticket.id
                 AND candidate_assignment.released_at IS NULL
                JOIN rotations candidate_rotation ON candidate_rotation.id = candidate_assignment.rotation_id
                JOIN flight_groups candidate_group ON candidate_group.id = candidate_rotation.flight_group_id
               WHERE candidate_ticket.ticket_group_id = tg.id
                 AND candidate_rotation.status = 'DRAFT'
               GROUP BY candidate_rotation.id, candidate_group.queue_position
               ORDER BY ${dispatchSegmentOrderSql("candidate_rotation", "candidate_group")},
                        candidate_rotation.created_at, candidate_rotation.id
               LIMIT 1
            )
          GROUP BY tg.id, r.id, tg.product_id, tg.queue_sequence, p.resource_group_id`,
      )
        .bind(command.eventId, ...distinctGroupIds)
        .all<{
          ticket_group_id: string;
          rotation_id: string;
          resource_group_id: string;
          product_id: string;
          queue_sequence: number;
          ticket_count: number;
        }>();
      selectedGroups = groupResult.results;
      if (selectedGroups.length !== distinctGroupIds.length) {
        return json(
          {
            error: {
              code: "TICKET_GROUP_NOT_AVAILABLE",
              message: "Mindestens eine Gruppe ist nicht mehr in der Warteschlange verfügbar.",
            },
          },
          { status: 409 },
        );
      }
      if (new Set(selectedGroups.map((group) => group.resource_group_id)).size !== 1) {
        return json(
          {
            error: {
              code: "RESOURCE_GROUP_MISMATCH",
              message: "Ausgewählte Gruppen gehören nicht zur gleichen Ressourcengruppe.",
            },
          },
          { status: 409 },
        );
      }
      const leaseId = command.payload.dispatchRecommendationLeaseId;
      if (leaseId) {
        if (!operatorAccountId || !command.payload.dispatchRecommendation) {
          return json(
            {
              error: {
                code: "DISPATCH_RECOMMENDATION_LEASE_MISMATCH",
                message: "Die Vorschlagsreservierung gehört nicht zu dieser Bestätigung.",
              },
            },
            { status: 409 },
          );
        }
        const lease = await this.env.DB.prepare(
          `SELECT id, operation_day_id, aircraft_id, operator_account_id, device_id,
                  acquire_command_id, dispatch_plan_revision, dispatch_batch_id,
                  dispatch_order, ticket_group_ids_json, occupied_seats, available_seats,
                  decision_reasons_json, operation_day_version, member_rotation_ids_json,
                  status, acquired_at, expires_at, version
             FROM dispatch_recommendation_leases
            WHERE id = ?1 AND operation_day_id = ?2`,
        )
          .bind(leaseId, command.eventId)
          .first<StoredDispatchRecommendationLease>();
        if (lease?.status !== "ACTIVE") {
          return json(
            {
              error: {
                code: "DISPATCH_RECOMMENDATION_LEASE_CONFLICT",
                message: "Die Vorschlagsreservierung ist nicht mehr aktiv.",
              },
            },
            { status: 409 },
          );
        }
        if (Date.parse(lease.expires_at) <= Date.now()) {
          return json(
            {
              error: {
                code: "DISPATCH_RECOMMENDATION_LEASE_EXPIRED",
                message: "Die Vorschlagsreservierung ist abgelaufen. Bitte neu reservieren.",
              },
            },
            { status: 409 },
          );
        }
        const leaseGroupIds = (JSON.parse(lease.ticket_group_ids_json) as string[]).sort();
        const leaseMemberRotationIds = (
          JSON.parse(lease.member_rotation_ids_json) as string[]
        ).sort();
        const selectedGroupIds = [...distinctGroupIds].sort();
        const selectedMemberRotationIds = [
          ...new Set(selectedGroups.map((group) => group.rotation_id)),
        ].sort();
        const selectedSeatCount = selectedGroups.reduce(
          (sum, group) => sum + Number(group.ticket_count),
          0,
        );
        const leaseMatches =
          lease.operator_account_id === operatorAccountId &&
          lease.device_id === command.deviceId &&
          lease.aircraft_id === command.payload.aircraftId &&
          lease.dispatch_plan_revision === command.payload.dispatchRecommendation.planRevision &&
          lease.dispatch_batch_id === command.payload.dispatchRecommendation.batchId &&
          leaseGroupIds.length === selectedGroupIds.length &&
          leaseGroupIds.every(
            (ticketGroupId, index) => ticketGroupId === selectedGroupIds[index],
          ) &&
          leaseMemberRotationIds.length === selectedMemberRotationIds.length &&
          leaseMemberRotationIds.every(
            (rotationId, index) => rotationId === selectedMemberRotationIds[index],
          ) &&
          lease.occupied_seats === selectedSeatCount;
        if (!leaseMatches) {
          return json(
            {
              error: {
                code: "DISPATCH_RECOMMENDATION_LEASE_MISMATCH",
                message:
                  "Die reservierte Belegung passt nicht mehr zum aktuellen Zustand. Bitte aktuellen Vorschlag laden.",
              },
            },
            { status: 409 },
          );
        }
        acceptedDispatchRecommendation = true;
        acceptedDispatchRecommendationLease = lease;
      } else if (command.payload.dispatchRecommendation) {
        const recommendedGroupIds = JSON.parse(rotation.dispatch_group_ids_json) as string[];
        const selectedGroupIds = [...distinctGroupIds].sort();
        const currentRecommendedGroupIds = [...recommendedGroupIds].sort();
        acceptedDispatchRecommendation =
          rotation.dispatch_operation_day_version === current.version &&
          rotation.dispatch_plan_revision === command.payload.dispatchRecommendation.planRevision &&
          rotation.dispatch_batch_id === command.payload.dispatchRecommendation.batchId &&
          rotation.forecast_assumed_aircraft_id === command.payload.aircraftId &&
          selectedGroupIds.length === currentRecommendedGroupIds.length &&
          selectedGroupIds.every(
            (ticketGroupId, index) => ticketGroupId === currentRecommendedGroupIds[index],
          );
        if (!acceptedDispatchRecommendation) {
          return json(
            {
              error: {
                code: "DISPATCH_PLAN_STALE",
                message:
                  "Die Belegungsempfehlung wurde inzwischen neu berechnet. Bitte aktuellen Plan prüfen.",
                currentPlanRevision: rotation.dispatch_plan_revision,
                currentBatchId: rotation.dispatch_batch_id,
              },
            },
            { status: 409 },
          );
        }
      }
      if (!leaseId) {
        const selectedGroupIdsJson = JSON.stringify(distinctGroupIds);
        const conflictingLeases = await this.env.DB.prepare(
          `SELECT lease.id, lease.operation_day_id, lease.aircraft_id,
                  lease.operator_account_id, lease.device_id, lease.acquire_command_id,
                  lease.dispatch_plan_revision, lease.dispatch_batch_id, lease.dispatch_order,
                  lease.ticket_group_ids_json, lease.occupied_seats, lease.available_seats,
                  lease.decision_reasons_json, lease.operation_day_version,
                  lease.member_rotation_ids_json, lease.status, lease.acquired_at,
                  lease.expires_at, lease.version
             FROM dispatch_recommendation_leases lease
            WHERE lease.operation_day_id = ?1
              AND lease.status = 'ACTIVE'
              AND lease.expires_at > ?2
              AND EXISTS (
                SELECT 1
                  FROM json_each(lease.ticket_group_ids_json) reserved_group
                  JOIN json_each(?3) selected_group
                    ON selected_group.value = reserved_group.value
              )
            ORDER BY lease.acquired_at, lease.id`,
        )
          .bind(command.eventId, new Date().toISOString(), selectedGroupIdsJson)
          .all<StoredDispatchRecommendationLease>();
        manualOverrideLeases = conflictingLeases.results;
        manualOverrideReason = command.payload.queueDeviationReason?.trim() ?? null;
        if (manualOverrideLeases.length > 0 && !manualOverrideReason) {
          return json(
            {
              error: {
                code: "QUEUE_DEVIATION_REASON_REQUIRED",
                message:
                  "Für die manuelle Übersteuerung eines reservierten Vorschlags ist ein Grund erforderlich.",
              },
            },
            { status: 409 },
          );
        }
      }
      let selectedProductId: string;
      try {
        selectedProductId = assertProductPureSelection(
          selectedGroups.map((group) => group.product_id),
        );
      } catch (reason: unknown) {
        if (!(reason instanceof DomainRuleError)) throw reason;
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      if (
        rotation.flight_group_product_id !== null &&
        rotation.flight_group_product_id !== selectedProductId
      ) {
        return json(
          {
            error: {
              code: "PRODUCT_MISMATCH",
              message: "Die Fluggruppe gehört nicht zum Produkt der ausgewählten Ticketgruppen.",
            },
          },
          { status: 409 },
        );
      }
      const turnaroundConfiguration = await this.env.DB.prepare(
        `SELECT p.planned_boarding_minutes_override AS product_boarding,
                p.planned_deboarding_minutes_override AS product_deboarding,
                p.planned_buffer_minutes_override AS product_buffer,
                override.planned_boarding_minutes_override AS aircraft_boarding,
                override.planned_deboarding_minutes_override AS aircraft_deboarding,
                override.planned_buffer_minutes_override AS aircraft_buffer
           FROM products p
           LEFT JOIN aircraft_product_turnaround_overrides override
             ON override.operation_day_id = p.operation_day_id
            AND override.product_id = p.id
            AND override.aircraft_id = ?3
          WHERE p.id = ?1 AND p.operation_day_id = ?2`,
      )
        .bind(selectedProductId, command.eventId, command.payload.aircraftId)
        .first<{
          product_boarding: number | null;
          product_deboarding: number | null;
          product_buffer: number | null;
          aircraft_boarding: number | null;
          aircraft_deboarding: number | null;
          aircraft_buffer: number | null;
        }>();
      if (!turnaroundConfiguration) {
        return json(
          { error: { code: "PRODUCT_NOT_FOUND", message: "Produkt nicht gefunden." } },
          { status: 404 },
        );
      }
      confirmedTurnaroundProductId = selectedProductId;
      confirmedTurnaroundProfile = resolveTurnaroundProfile({
        event: {
          sourceId: command.eventId,
          boardingMinutes: current.planned_boarding_minutes ?? 8,
          deboardingMinutes: current.planned_deboarding_minutes ?? 5,
          bufferMinutes: current.planned_buffer_minutes ?? 3,
        },
        product: {
          sourceId: selectedProductId,
          boardingMinutes: turnaroundConfiguration.product_boarding,
          deboardingMinutes: turnaroundConfiguration.product_deboarding,
          bufferMinutes: turnaroundConfiguration.product_buffer,
        },
        aircraftProduct: {
          sourceId: `${command.payload.aircraftId}:${selectedProductId}`,
          boardingMinutes: turnaroundConfiguration.aircraft_boarding,
          deboardingMinutes: turnaroundConfiguration.aircraft_deboarding,
          bufferMinutes: turnaroundConfiguration.aircraft_buffer,
        },
      });
      const earliestSelectedQueueSequence = Math.min(
        ...selectedGroups.map((group) => Number(group.queue_sequence)),
      );
      const skippedEarlierResult = await this.env.DB.prepare(
        `SELECT tg.id
           FROM ticket_groups tg
           JOIN products p ON p.id = tg.product_id
          WHERE tg.operation_day_id = ?1
            AND p.resource_group_id = ?2
            AND tg.product_id <> ?3
            AND tg.queue_sequence < ?4
            AND tg.status IN ('QUEUED', 'PRESENT')
            AND EXISTS (
              SELECT 1
                FROM tickets earlier_ticket
                JOIN rotation_tickets earlier_assignment
                  ON earlier_assignment.ticket_id = earlier_ticket.id
                 AND earlier_assignment.released_at IS NULL
                JOIN rotations earlier_rotation
                  ON earlier_rotation.id = earlier_assignment.rotation_id
               WHERE earlier_ticket.ticket_group_id = tg.id
                 AND earlier_rotation.status = 'DRAFT'
            )
          ORDER BY tg.queue_sequence, tg.id`,
      )
        .bind(
          command.eventId,
          selectedGroups[0]?.resource_group_id,
          selectedProductId,
          earliestSelectedQueueSequence,
        )
        .all<{ id: string }>();
      skippedEarlierTicketGroupIds = skippedEarlierResult.results.map((group) => group.id);
      if (
        skippedEarlierTicketGroupIds.length > 0 &&
        !acceptedDispatchRecommendation &&
        !command.payload.queueDeviationReason?.trim()
      ) {
        return json(
          {
            error: {
              code: "QUEUE_DEVIATION_REASON_REQUIRED",
              message:
                "Für das Überspringen früherer Ticketgruppen eines anderen Produkts ist ein Grund erforderlich.",
            },
          },
          { status: 409 },
        );
      }
      const candidate = await this.env.DB.prepare(
        `SELECT a.id, a.passenger_seats, a.operational_state,
                membership.current_pilot_id
           FROM rotations r
           JOIN flight_groups fg ON fg.id = r.flight_group_id
           JOIN resource_group_memberships membership
             ON membership.resource_group_id = fg.resource_group_id
            AND membership.operation_day_id = r.operation_day_id
            AND membership.active_until IS NULL
           JOIN aircraft a ON a.id = membership.aircraft_id
          WHERE r.id = ?1 AND a.id = ?2
          GROUP BY a.id`,
      )
        .bind(rotation.id, command.payload.aircraftId)
        .first<{
          id: string;
          passenger_seats: number;
          operational_state: string;
          current_pilot_id: string | null;
        }>();
      if (candidate?.operational_state !== "AVAILABLE") {
        return json(
          { error: { code: "AIRCRAFT_NOT_AVAILABLE", message: "Flugzeug ist nicht verfügbar." } },
          { status: 409 },
        );
      }
      const selectedTicketCount = selectedGroups.reduce(
        (sum, group) => sum + Number(group.ticket_count),
        0,
      );
      if (selectedTicketCount > candidate.passenger_seats) {
        return json(
          {
            error: {
              code: "AIRCRAFT_CAPACITY_EXCEEDED",
              message: "Flugzeugkapazität reicht nicht aus.",
            },
          },
          { status: 409 },
        );
      }
      if (!candidate.current_pilot_id || candidate.current_pilot_id !== command.payload.pilotId) {
        return json(
          {
            error: {
              code: "AIRCRAFT_PILOT_ASSIGNMENT_MISMATCH",
              message:
                "Der bestätigte Pilotencode entspricht nicht der Pilotenzuweisung am Flugzeug.",
            },
          },
          { status: 409 },
        );
      }
      const pilot = await this.env.DB.prepare(
        `SELECT p.id FROM pilots p
          WHERE p.id = ?1 AND p.operation_day_id = ?2 AND p.active = 1 AND p.paused = 0
            AND NOT EXISTS (
              SELECT 1 FROM rotations active_rotation
               WHERE active_rotation.operation_day_id = p.operation_day_id
                 AND active_rotation.pilot_id = p.id
                 AND active_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
            )`,
      )
        .bind(command.payload.pilotId, command.eventId)
        .first<{ id: string }>();
      if (!pilot) {
        return json(
          {
            error: {
              code: "PILOT_NOT_AVAILABLE",
              message: "Pilotencode ist nicht aktiv verfügbar.",
            },
          },
          { status: 409 },
        );
      }
    }
    const target = {
      CALL_NEXT: "CALLED",
      MARK_OFF_BLOCK: "IN_FLIGHT",
      MARK_ON_BLOCK: "LANDED",
      COMPLETE_TURNAROUND: "COMPLETED",
      CANCEL_ROTATION: "CANCELED",
    } as const;
    const timestampColumn = {
      CALL_NEXT: "called_at",
      MARK_OFF_BLOCK: "departed_at",
      MARK_ON_BLOCK: "landed_at",
      COMPLETE_TURNAROUND: "completed_at",
      CANCEL_ROTATION: "completed_at",
    } as const;
    let nextState: typeof rotation.status;
    try {
      nextState = transitionRotation(rotation.status, target[command.type]);
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError)
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      throw reason;
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType = {
      CALL_NEXT: "FLIGHT_GROUP_CALLED",
      MARK_OFF_BLOCK: "MARK_OFF_BLOCK",
      MARK_ON_BLOCK: "MARK_ON_BLOCK",
      COMPLETE_TURNAROUND: "TURNAROUND_COMPLETED",
      CANCEL_ROTATION: "ROTATION_CANCELED",
    } as const;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: eventType[command.type],
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    const recallClosures =
      command.type === "CALL_NEXT"
        ? await this.loadOpenTicketGroupRecalls(
            command.eventId,
            selectedGroups.map((group) => group.ticket_group_id),
            now,
          )
        : [];
    const selectedAircraftId =
      command.type === "CALL_NEXT" ? command.payload.aircraftId : rotation.aircraft_id;
    if (!selectedAircraftId) {
      return json(
        { error: { code: "AIRCRAFT_ASSIGNMENT_REQUIRED", message: "Flugzeugzuordnung fehlt." } },
        { status: 409 },
      );
    }
    const selectedPilotId =
      command.type === "CALL_NEXT" ? command.payload.pilotId : rotation.pilot_id;
    if (!selectedPilotId) {
      return json(
        { error: { code: "PILOT_ASSIGNMENT_REQUIRED", message: "Pilotenzuordnung fehlt." } },
        { status: 409 },
      );
    }
    const aircraftState =
      command.type === "COMPLETE_TURNAROUND"
        ? command.payload.nextAircraftState
        : {
            CALL_NEXT: "BOARDING",
            MARK_OFF_BLOCK: "IN_FLIGHT",
            MARK_ON_BLOCK: "LANDED",
            CANCEL_ROTATION: "AVAILABLE",
          }[command.type];
    if (command.type === "CALL_NEXT") {
      const selectedMemberQueueSequence = new Map<string, number>();
      for (const group of selectedGroups) {
        selectedMemberQueueSequence.set(
          group.rotation_id,
          Math.min(
            selectedMemberQueueSequence.get(group.rotation_id) ?? Number.MAX_SAFE_INTEGER,
            Number(group.queue_sequence),
          ),
        );
      }
      const waitingMembers = await this.dispatchRecommendationLeases.eligibleDraftMembers(
        command.eventId,
        selectedGroups[0]?.resource_group_id ?? "",
      );
      confirmedOvertakeIncrements = calculateConfirmedOvertakeIncrements({
        selectedMembers: [...selectedMemberQueueSequence].map(([rotationId, queueSequence]) => ({
          rotationId,
          queueSequence,
        })),
        waitingMembers,
      });
    }
    const confirmedOvertakeStatements = confirmedOvertakeIncrements.map((entry) =>
      this.env.DB.prepare(
        `UPDATE rotations
            SET dispatch_confirmed_overtake_count =
                  dispatch_confirmed_overtake_count + ?1
          WHERE id = ?2 AND operation_day_id = ?3 AND status = 'DRAFT'`,
      ).bind(entry.increment, entry.rotationId, command.eventId),
    );
    const groupMoveStatements =
      command.type === "CALL_NEXT"
        ? selectedGroups
            .filter((group) => group.rotation_id !== rotation.id)
            .flatMap((group) => [
              this.env.DB.prepare(
                `UPDATE rotation_tickets SET released_at = ?1
                  WHERE rotation_id = ?2 AND released_at IS NULL
                    AND ticket_id IN (SELECT id FROM tickets WHERE ticket_group_id = ?3)`,
              ).bind(now, group.rotation_id, group.ticket_group_id),
              this.env.DB.prepare(
                `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
                 SELECT ?1, moved_assignment.ticket_id, ?2
                   FROM rotation_tickets moved_assignment
                   JOIN tickets moved_ticket ON moved_ticket.id = moved_assignment.ticket_id
                  WHERE moved_assignment.rotation_id = ?3
                    AND moved_assignment.released_at = ?2
                    AND moved_ticket.ticket_group_id = ?4`,
              ).bind(rotation.id, now, group.rotation_id, group.ticket_group_id),
              this.env.DB.prepare(
                `UPDATE rotations SET status = 'CANCELED', completed_at = ?1,
                        version = version + 1, updated_at = ?1
                  WHERE id = ?2 AND status = 'DRAFT'
                    AND NOT EXISTS (
                      SELECT 1 FROM rotation_tickets remaining_assignment
                       WHERE remaining_assignment.rotation_id = rotations.id
                         AND remaining_assignment.released_at IS NULL
                    )`,
              ).bind(now, group.rotation_id),
              this.env.DB.prepare(
                `UPDATE flight_groups SET status = 'CANCELED', version = version + 1, updated_at = ?1
                  WHERE id = (
                    SELECT flight_group_id FROM rotations
                     WHERE id = ?2 AND status = 'CANCELED'
                  )`,
              ).bind(now, group.rotation_id),
            ])
        : [];
    const recurringProgressStatements: D1PreparedStatement[] = [];
    if (command.type === "COMPLETE_TURNAROUND") {
      const recurringRules = await this.env.DB.prepare(
        `SELECT rule.id, rule.version, rule.scope_type, rule.scope_id, rule.operation_kind,
                rule.trigger_metric, rule.interval_value, rule.progress_value,
                rule.minimum_duration_minutes, rule.typical_duration_minutes,
                rule.maximum_duration_minutes, rule.sequence_number,
                (SELECT plan.id FROM planned_operational_constraints plan
                  WHERE plan.recurring_rule_id = rule.id
                    AND plan.status IN ('PLANNED', 'ACTIVE')
                  ORDER BY plan.recurrence_sequence DESC LIMIT 1) AS open_plan_id
           FROM recurring_operational_rules rule
          WHERE rule.operation_day_id = ?1 AND rule.status = 'ACTIVE'
            AND (
              (rule.scope_type = 'AIRCRAFT' AND rule.scope_id = ?2)
              OR (rule.scope_type = 'PILOT' AND rule.scope_id = ?3)
            )
          ORDER BY rule.scope_type, rule.scope_id, rule.operation_kind, rule.id`,
      )
        .bind(command.eventId, selectedAircraftId, selectedPilotId)
        .all<{
          id: string;
          version: number;
          scope_type: "AIRCRAFT" | "PILOT";
          scope_id: string;
          operation_kind: "PAUSE" | "REFUELING";
          trigger_metric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
          interval_value: number;
          progress_value: number;
          minimum_duration_minutes: number;
          typical_duration_minutes: number;
          maximum_duration_minutes: number;
          sequence_number: number;
          open_plan_id: string | null;
        }>();
      const operatingMinutes = rotation.called_at
        ? Math.max(0, Math.round((Date.parse(now) - Date.parse(rotation.called_at)) / 60_000))
        : 0;
      const withinOperations =
        !current.operations_end_at || Date.parse(now) < Date.parse(current.operations_end_at);
      for (const rule of recurringRules.results) {
        const increment = rule.trigger_metric === "COMPLETED_ROTATIONS" ? 1 : operatingMinutes;
        const progressValue = rule.progress_value + increment;
        const becomesDue =
          withinOperations && progressValue >= rule.interval_value && rule.open_plan_id === null;
        const nextSequence = rule.sequence_number + (becomesDue ? 1 : 0);
        recurringProgressStatements.push(
          this.env.DB.prepare(
            `UPDATE recurring_operational_rules
                SET progress_value = ?1, sequence_number = ?2, version = version + 1,
                    updated_at = ?3
              WHERE id = ?4 AND operation_day_id = ?5 AND version = ?6
                AND status = 'ACTIVE'`,
          ).bind(progressValue, nextSequence, now, rule.id, command.eventId, rule.version),
        );
        if (!becomesDue) continue;
        const occurrenceId = crypto.randomUUID();
        recurringProgressStatements.push(
          this.env.DB.prepare(
            `INSERT INTO planned_operational_constraints
              (id, operation_day_id, scope_type, scope_id, constraint_kind, start_mode,
               earliest_start_at, latest_start_at, after_rotation_id, effect_mode,
               duration_multiplier_percent, minimum_duration_minutes, typical_duration_minutes,
               maximum_duration_minutes, status, reason, public_note, version,
               created_by_device_id, created_at, updated_at, recurring_rule_id, recurrence_sequence)
             VALUES (?1, ?2, ?3, ?4, ?5, 'AFTER_CURRENT_ROTATION', NULL, NULL, ?6,
                     'BLOCKING', NULL, ?7, ?8, ?9, 'PLANNED', ?10, '', 0, ?11, ?12, ?12, ?13, ?14)`,
          ).bind(
            occurrenceId,
            command.eventId,
            rule.scope_type,
            rule.scope_id,
            rule.operation_kind,
            rotation.id,
            rule.minimum_duration_minutes,
            rule.typical_duration_minutes,
            rule.maximum_duration_minutes,
            "Wiederkehrende Regel nach bestätigtem Umlauf fällig.",
            command.deviceId,
            now,
            rule.id,
            nextSequence,
          ),
          this.env.DB.prepare(
            `INSERT INTO operational_events
              (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
               aggregate_id, aggregate_version, payload_json)
             VALUES (?1, ?2, 'RECURRING_OPERATION_DUE', ?3, ?4, 'OPERATIONAL_RULE', ?5, ?6, ?7)`,
          ).bind(
            crypto.randomUUID(),
            command.eventId,
            now,
            command.deviceId,
            rule.id,
            rule.version + 1,
            JSON.stringify({
              occurrenceId,
              recurrenceSequence: nextSequence,
              afterRotationId: rotation.id,
              progressValue,
              intervalValue: rule.interval_value,
              triggerMetric: rule.trigger_metric,
            }),
          ),
        );
      }
    }
    const manualOverrideLeaseStatements = manualOverrideLeases.flatMap((overriddenLease) => {
      const overridePayload = {
        action: "INVALIDATED",
        reason: "MANUAL_OVERRIDE",
        leaseId: overriddenLease.id,
        aircraftId: overriddenLease.aircraft_id,
        batchId: overriddenLease.dispatch_batch_id,
        overridingCommandId: command.commandId,
        queueDeviationReason: manualOverrideReason,
      };
      return [
        this.env.DB.prepare(
          `UPDATE dispatch_recommendation_leases
              SET status = 'INVALIDATED', invalidated_at = ?1, version = version + 1
            WHERE id = ?2 AND operation_day_id = ?3 AND status = 'ACTIVE'
              AND version = ?4 AND expires_at > ?1`,
        ).bind(now, overriddenLease.id, command.eventId, overriddenLease.version),
        this.env.DB.prepare(
          `INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
             aggregate_id, aggregate_version, payload_json)
           VALUES (?1, ?2, 'DISPATCH_RECOMMENDATION_LEASE_INVALIDATED', ?3, ?4,
                   'DISPATCH_LEASE', ?5, ?6, ?7)`,
        ).bind(
          crypto.randomUUID(),
          command.eventId,
          now,
          command.deviceId,
          overriddenLease.id,
          overriddenLease.version + 1,
          JSON.stringify(overridePayload),
        ),
        this.env.DB.prepare(
          `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
           VALUES (?1, ?2, 'DISPATCH_LEASE_CHANGED', ?3, ?4)`,
        ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(overridePayload), now),
      ];
    });
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      ...manualOverrideLeaseStatements,
      ...confirmedOvertakeStatements,
      ...groupMoveStatements,
      this.env.DB.prepare(
        `UPDATE rotations SET status = ?1, ${timestampColumn[command.type]} = ?2, aircraft_id = ?3,
                pilot_id = ?4,
                forecast_assumed_aircraft_id =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN NULL ELSE forecast_assumed_aircraft_id END,
                turnaround_product_id =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?6 ELSE turnaround_product_id END,
                turnaround_aircraft_id =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?7 ELSE turnaround_aircraft_id END,
                turnaround_boarding_minutes =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?8 ELSE turnaround_boarding_minutes END,
                turnaround_deboarding_minutes =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?9 ELSE turnaround_deboarding_minutes END,
                turnaround_buffer_minutes =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?10 ELSE turnaround_buffer_minutes END,
                turnaround_boarding_source =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?11 ELSE turnaround_boarding_source END,
                turnaround_deboarding_source =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?12 ELSE turnaround_deboarding_source END,
                turnaround_buffer_source =
                  CASE WHEN ?5 = 'CALL_NEXT' THEN ?13 ELSE turnaround_buffer_source END,
                version = version + 1, updated_at = ?2
          WHERE id = ?14 AND version = ?15`,
      ).bind(
        nextState,
        now,
        selectedAircraftId,
        selectedPilotId,
        command.type,
        confirmedTurnaroundProductId,
        selectedAircraftId,
        confirmedTurnaroundProfile?.boarding.valueMinutes ?? null,
        confirmedTurnaroundProfile?.deboarding.valueMinutes ?? null,
        confirmedTurnaroundProfile?.buffer.valueMinutes ?? null,
        confirmedTurnaroundProfile
          ? `${confirmedTurnaroundProfile.boarding.sourceLevel}:${confirmedTurnaroundProfile.boarding.sourceId}`
          : null,
        confirmedTurnaroundProfile
          ? `${confirmedTurnaroundProfile.deboarding.sourceLevel}:${confirmedTurnaroundProfile.deboarding.sourceId}`
          : null,
        confirmedTurnaroundProfile
          ? `${confirmedTurnaroundProfile.buffer.sourceLevel}:${confirmedTurnaroundProfile.buffer.sourceId}`
          : null,
        rotation.id,
        rotation.version,
      ),
      this.env.DB.prepare(
        "UPDATE flight_groups SET status = ?1, version = version + 1, updated_at = ?2 WHERE id = (SELECT flight_group_id FROM rotations WHERE id = ?3)",
      ).bind(nextState, now, rotation.id),
      this.env.DB.prepare(
        `UPDATE aircraft SET operational_state = ?1,
                operational_state_changed_at = CASE
                  WHEN operational_state <> ?1 THEN ?2 ELSE operational_state_changed_at END,
                version = version + 1, updated_at = ?2,
                rotations_since_refuel = rotations_since_refuel + ?4 WHERE id = ?3`,
      ).bind(
        aircraftState,
        now,
        selectedAircraftId,
        command.type === "COMPLETE_TURNAROUND" ? 1 : 0,
      ),
      ...recurringProgressStatements,
      this.env.DB.prepare(
        `UPDATE tickets SET status = CASE
            WHEN ?1 = 'CALL_NEXT' THEN 'BOARDING'
            WHEN ?1 = 'CANCEL_ROTATION' THEN 'QUEUED'
            ELSE ?2
          END
          WHERE id IN (
            SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?3 AND released_at IS NULL
          )`,
      ).bind(command.type, nextState, rotation.id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET status = CASE
            WHEN ticket_groups.status IN ('MISSING', 'CLARIFICATION') THEN ticket_groups.status
            WHEN EXISTS (
              SELECT 1 FROM tickets segment_ticket
              JOIN rotation_tickets segment_assignment
                ON segment_assignment.ticket_id = segment_ticket.id
               AND segment_assignment.released_at IS NULL
              JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
              WHERE segment_ticket.ticket_group_id = ticket_groups.id
                AND segment_rotation.status = 'DRAFT'
            ) THEN CASE WHEN EXISTS (
              SELECT 1 FROM tickets pending_ticket
              JOIN rotation_tickets pending_assignment
                ON pending_assignment.ticket_id = pending_ticket.id
               AND pending_assignment.released_at IS NULL
              JOIN rotations pending_rotation ON pending_rotation.id = pending_assignment.rotation_id
              WHERE pending_ticket.ticket_group_id = ticket_groups.id
                AND pending_rotation.status = 'DRAFT'
                AND pending_ticket.attendance_status = 'CHECKED_IN'
            ) THEN 'PRESENT' ELSE 'QUEUED' END
            WHEN EXISTS (
              SELECT 1 FROM tickets segment_ticket
              JOIN rotation_tickets segment_assignment
                ON segment_assignment.ticket_id = segment_ticket.id
               AND segment_assignment.released_at IS NULL
              JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
              WHERE segment_ticket.ticket_group_id = ticket_groups.id
                AND segment_rotation.status = 'CALLED'
            ) THEN 'BOARDING'
            WHEN EXISTS (
              SELECT 1 FROM tickets segment_ticket
              JOIN rotation_tickets segment_assignment
                ON segment_assignment.ticket_id = segment_ticket.id
               AND segment_assignment.released_at IS NULL
              JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
              WHERE segment_ticket.ticket_group_id = ticket_groups.id
                AND segment_rotation.status = 'IN_FLIGHT'
            ) THEN 'IN_FLIGHT'
            WHEN EXISTS (
              SELECT 1 FROM tickets segment_ticket
              JOIN rotation_tickets segment_assignment
                ON segment_assignment.ticket_id = segment_ticket.id
               AND segment_assignment.released_at IS NULL
              JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
              WHERE segment_ticket.ticket_group_id = ticket_groups.id
                AND segment_rotation.status = 'LANDED'
            ) THEN 'LANDED'
            WHEN EXISTS (
              SELECT 1 FROM tickets segment_ticket
              JOIN rotation_tickets segment_assignment
                ON segment_assignment.ticket_id = segment_ticket.id
               AND segment_assignment.released_at IS NULL
              JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
              WHERE segment_ticket.ticket_group_id = ticket_groups.id
                AND segment_rotation.status = 'COMPLETED'
            ) THEN 'COMPLETED'
            ELSE 'CANCELED'
          END,
          version = version + 1
          WHERE id IN (
            SELECT DISTINCT t.ticket_group_id
              FROM tickets t
              JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
             WHERE rt.rotation_id = ?1
           )`,
      ).bind(rotation.id),
      ...this.ticketGroupRecallClosureStatements({
        recalls: recallClosures,
        eventId: command.eventId,
        reason: "BOARDING",
        deviceId: command.deviceId,
        now,
        event: result.event,
      }),
      this.env.DB.prepare(`INSERT INTO operational_events (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type, aggregate_id, aggregate_version, payload_json)
        VALUES (?1, ?2, ?3, ?4, ?5, 'ROTATION', ?6, ?7, ?8)`).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType[command.type],
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({
          from: rotation.status,
          to: nextState,
          aircraftId: selectedAircraftId,
          pilotId: selectedPilotId,
          queueDeviationReason:
            command.type === "CALL_NEXT"
              ? (command.payload.queueDeviationReason ??
                (acceptedDispatchRecommendation ? "CAPACITY_OPTIMIZED_DISPATCH" : null))
              : null,
          dispatchRecommendation:
            command.type === "CALL_NEXT" && acceptedDispatchRecommendation
              ? command.payload.dispatchRecommendation
              : null,
          dispatchRecommendationLeaseId:
            command.type === "CALL_NEXT" ? (acceptedDispatchRecommendationLease?.id ?? null) : null,
          skippedTicketGroupIds: command.type === "CALL_NEXT" ? skippedEarlierTicketGroupIds : [],
          confirmedOvertakes: command.type === "CALL_NEXT" ? confirmedOvertakeIncrements : [],
        }),
      ),
      ...(acceptedDispatchRecommendationLease
        ? [
            this.env.DB.prepare(
              `UPDATE dispatch_recommendation_leases
                  SET status = 'CONSUMED', consumed_at = ?1, version = version + 1
                WHERE id = ?2 AND operation_day_id = ?3 AND status = 'ACTIVE'
                  AND operator_account_id = ?4 AND device_id = ?5 AND aircraft_id = ?6
                  AND expires_at > ?1`,
            ).bind(
              now,
              acceptedDispatchRecommendationLease.id,
              command.eventId,
              operatorAccountId,
              command.deviceId,
              selectedAircraftId,
            ),
            this.env.DB.prepare(
              `INSERT INTO operational_events
                (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
                 aggregate_id, aggregate_version, payload_json)
               VALUES (?1, ?2, 'DISPATCH_RECOMMENDATION_LEASE_CONSUMED', ?3, ?4,
                       'DISPATCH_LEASE', ?5, ?6, ?7)`,
            ).bind(
              crypto.randomUUID(),
              command.eventId,
              now,
              command.deviceId,
              acceptedDispatchRecommendationLease.id,
              acceptedDispatchRecommendationLease.version + 1,
              JSON.stringify({
                aircraftId: selectedAircraftId,
                rotationId: rotation.id,
                dispatchBatchId: acceptedDispatchRecommendationLease.dispatch_batch_id,
              }),
            ),
          ]
        : []),
      this.env.DB.prepare(`INSERT INTO idempotency_receipts (command_id, operation_day_id, device_id, command_type, received_at, response_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
        command.commandId,
        command.eventId,
        command.deviceId,
        command.type,
        now,
        JSON.stringify(result),
      ),
      this.env.DB.prepare(
        "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), now),
    ]);
    const pushEvent = {
      CALL_NEXT: "BOARDING_STARTED",
      MARK_OFF_BLOCK: "ROTATION_STARTED",
      MARK_ON_BLOCK: "ROTATION_LANDED",
      COMPLETE_TURNAROUND: "ROTATION_COMPLETED",
      CANCEL_ROTATION: null,
    } as const;
    const notification = pushEvent[command.type];
    if (notification) {
      this.ctx.waitUntil(sendRotationPushNotifications(this.env, rotation.id, notification));
    }
    this.broadcast(result);
    return json(result);
  }
}
