import { DurableObject } from "cloudflare:workers";
import {
  type CommandEnvelope,
  type CommandResult,
  commandEnvelopeSchema,
  commandResultSchema,
} from "@rundflug/contracts";
import {
  assertMayStageOutageRecoveryEntry,
  assertRoleMayExecute,
  type DeviceRole,
  DomainRuleError,
  type OperationalCommandType,
} from "@rundflug/domain";
import {
  type AnalysisSnapshotCaptureInput,
  type AnalysisSnapshotCaptureResult,
  AnalysisSnapshotCaptureService,
} from "./analysis-snapshot-capture-service";
import { AssistClaimService } from "./assist-claim-service";
import { AttendanceCommandService } from "./attendance-command-service";
import { dispatchRegisteredCommand } from "./command-handler-registry";
import { loadCommandPreflightReads } from "./command-preflight";
import { CommandPreflightService } from "./command-preflight-service";
import type { CommandPreflightReads } from "./command-preflight-types";
import { CoordinatorRealtimeService } from "./coordinator-realtime-service";
import { verifyCredential } from "./crypto";
import { DispatchRecommendationLeaseService } from "./dispatch-recommendation-lease-service";
import { EventAdministrationCommandService } from "./event-administration-command-service";
import { createEventCommandHandlers, type EventCommandServices } from "./event-command-handlers";
import {
  validateCommandVersion,
  validatePlannedOperationLink,
} from "./event-coordinator-preflight-policy";
import { FidsPreferencesCommandService } from "./fids-preferences-command-service";
import { FleetAdministrationCommandService } from "./fleet-administration-command-service";
import {
  type ForecastRecalculationRequest,
  ForecastTimelineService,
} from "./forecast-timeline-service";
import { MasterDataCommandService } from "./master-data-command-service";
import { OperationalControlCommandService } from "./operational-control-command-service";
import { OperationalNoteCommandService } from "./operational-note-command-service";
import { OutageRecoveryCommandService } from "./outage-recovery-command-service";
import { PilotAssignmentCommandService } from "./pilot-assignment-command-service";
import { PlannedOperationCommandService } from "./planned-operation-command-service";
import { ProductSalesCommandService } from "./product-sales-command-service";
import { RecurringOperationalRuleCommandService } from "./recurring-operational-rule-command-service";
import { RotationCorrectionCommandService } from "./rotation-correction-command-service";
import { RotationNoteCommandService } from "./rotation-note-command-service";
import { RotationRecoveryCommandService } from "./rotation-recovery-command-service";
import { RotationTransitionCommandService } from "./rotation-transition-command-service";
import { safeErrorMessage } from "./snapshot";
import { TicketGroupMutationCommandService } from "./ticket-group-mutation-command-service";
import { TicketGroupRecallPersistenceService } from "./ticket-group-recall-persistence-service";
import { TicketSalesCommandService } from "./ticket-sales-command-service";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const FORECAST_TICK_INTERVAL_MS = 30_000;
const FORECAST_COMMAND_DEBOUNCE_MS = 150;

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
  private readonly ticketGroupRecallPersistence = new TicketGroupRecallPersistenceService(
    this.env,
    (result) => this.broadcast(result),
  );
  private readonly attendanceCommands = new AttendanceCommandService(
    this.env,
    (result) => this.broadcast(result),
    (promise) => this.ctx.waitUntil(promise),
    (eventId, ticketGroupIds, onlyUnexpiredAt) =>
      this.ticketGroupRecallPersistence.loadOpen(eventId, ticketGroupIds, onlyUnexpiredAt),
    (input) => this.ticketGroupRecallPersistence.closureStatements(input),
  );
  private readonly ticketGroupMutationCommands = new TicketGroupMutationCommandService(
    this.env,
    (result) => this.broadcast(result),
    (eventId, ticketGroupIds, onlyUnexpiredAt) =>
      this.ticketGroupRecallPersistence.loadOpen(eventId, ticketGroupIds, onlyUnexpiredAt),
    (input) => this.ticketGroupRecallPersistence.closureStatements(input),
  );
  private readonly eventAdministrationCommands = new EventAdministrationCommandService(
    this.env,
    (result) => this.broadcast(result),
    (promise) => this.ctx.waitUntil(promise),
    () => this.forecastWork,
  );
  private readonly operationalNoteCommands = new OperationalNoteCommandService(this.env, (result) =>
    this.broadcast(result),
  );
  private readonly assistClaims = new AssistClaimService(
    this.env,
    (pathname) => this.eventIdFromPath(pathname),
    (eventVersion, eventType) => this.broadcastBoardRefresh(eventVersion, eventType),
  );
  private readonly commandPreflight = new CommandPreflightService(this.env.DB);
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
  private readonly ticketSalesCommands = new TicketSalesCommandService(this.env, (result) =>
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
  private readonly rotationNoteCommands = new RotationNoteCommandService(this.env, (result) =>
    this.broadcast(result),
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
  private readonly rotationTransitionCommands = new RotationTransitionCommandService(
    this.env,
    (result) => this.broadcast(result),
    (promise) => this.ctx.waitUntil(promise),
    (eventId, ticketGroupIds, onlyUnexpiredAt) =>
      this.ticketGroupRecallPersistence.loadOpen(eventId, ticketGroupIds, onlyUnexpiredAt),
    (input) => this.ticketGroupRecallPersistence.closureStatements(input),
    (eventId, resourceGroupId) =>
      this.dispatchRecommendationLeases.eligibleDraftMembers(eventId, resourceGroupId),
  );
  private readonly commandServices = {
    attendanceCommands: this.attendanceCommands,
    eventAdministrationCommands: this.eventAdministrationCommands,
    fleetAdministrationCommands: this.fleetAdministrationCommands,
    masterDataCommands: this.masterDataCommands,
    operationalControlCommands: this.operationalControlCommands,
    operationalNoteCommands: this.operationalNoteCommands,
    outageRecoveryCommands: this.outageRecoveryCommands,
    pilotAssignmentCommands: this.pilotAssignmentCommands,
    plannedOperationCommands: this.plannedOperationCommands,
    productSalesCommands: this.productSalesCommands,
    recurringOperationalRuleCommands: this.recurringOperationalRuleCommands,
    rotationCorrectionCommands: this.rotationCorrectionCommands,
    rotationNoteCommands: this.rotationNoteCommands,
    rotationRecoveryCommands: this.rotationRecoveryCommands,
    rotationTransitionCommands: this.rotationTransitionCommands,
    ticketGroupMutationCommands: this.ticketGroupMutationCommands,
    ticketSalesCommands: this.ticketSalesCommands,
  } satisfies EventCommandServices;

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
      await this.ticketGroupRecallPersistence.expire(event);
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

  private trustedOperatorRole(request: Request, command: CommandEnvelope): DeviceRole | null {
    const operatorRole = request.headers.get("x-operator-role") as DeviceRole | null;
    const operatorDeviceId = request.headers.get("x-operator-device-id");
    return operatorRole && operatorDeviceId === command.deviceId ? operatorRole : null;
  }

  private async duplicateReceipt(command: CommandEnvelope): Promise<Response | null> {
    const prior = await this.env.DB.prepare(
      "SELECT response_json FROM idempotency_receipts WHERE command_id = ?1",
    )
      .bind(command.commandId)
      .first<{ response_json: string }>();
    if (!prior) return null;
    const stored = commandResultSchema.parse(JSON.parse(prior.response_json));
    return json({ ...stored, duplicate: true });
  }

  private async authorizeCommandDevice(
    request: Request,
    command: CommandEnvelope,
    trustedOperatorRole: DeviceRole | null,
  ): Promise<{ role: DeviceRole; credential_hash: string | null } | Response> {
    if (trustedOperatorRole) return { role: trustedOperatorRole, credential_hash: null };
    const device = await this.env.DB.prepare(
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
    return device;
  }

  private validateCommandRole(deviceRole: DeviceRole, command: CommandEnvelope): Response | null {
    try {
      assertRoleMayExecute(deviceRole, command.type as OperationalCommandType);
      if (command.type === "STAGE_OUTAGE_RECOVERY") {
        for (const entry of command.payload.entries) {
          assertMayStageOutageRecoveryEntry(deviceRole, entry.type);
        }
      }
      return null;
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 403 });
      }
      throw reason;
    }
  }

  private validateActiveOperatorClaim(
    deviceRole: DeviceRole,
    operatorAccountId: string | null,
    claim: { aircraft_id: string } | null,
    command: CommandEnvelope,
    fallbackAircraftId: string | null,
  ): Response | null {
    if (deviceRole !== "FLIGHT_LINE" || !operatorAccountId) return null;
    if (!claim) {
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
      typeof payload.aircraftId === "string" ? payload.aircraftId : fallbackAircraftId;
    if (!targetAircraftId || targetAircraftId === claim.aircraft_id) return null;
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

  private async parseCommand(request: Request): Promise<CommandEnvelope | Response> {
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
    if (eventIdFromPath === command.eventId) return command;
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

  private validatePreflight(
    command: CommandEnvelope,
    preflight: CommandPreflightReads,
  ): StoredEventRow | Response {
    if (!preflight.current) {
      return json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        { status: 404 },
      );
    }
    const conflict =
      validateCommandVersion(command, preflight.current, preflight.aggregateVersion) ??
      validatePlannedOperationLink(command, preflight.plannedOperation);
    return conflict ?? preflight.current;
  }

  private async handleCommand(request: Request): Promise<Response> {
    const parsedCommand = await this.parseCommand(request);
    if (parsedCommand instanceof Response) return parsedCommand;
    const command = parsedCommand;

    try {
      const trustedOperatorRole = this.trustedOperatorRole(request, command);
      if (!trustedOperatorRole) {
        const duplicate = await this.duplicateReceipt(command);
        if (duplicate) return duplicate;
      }
      const device = await this.authorizeCommandDevice(request, command, trustedOperatorRole);
      if (device instanceof Response) return device;
      const operatorAccountId = request.headers.get("x-operator-account-id");
      const commandNow = new Date();
      const trustedPreflight = trustedOperatorRole
        ? await this.commandPreflight.loadTrusted({
            command,
            deviceRole: device.role,
            operatorAccountId,
            now: commandNow,
          })
        : null;
      if (trustedPreflight?.duplicateResult) {
        return json({ ...trustedPreflight.duplicateResult, duplicate: true });
      }
      const roleError = this.validateCommandRole(device.role, command);
      if (roleError) return roleError;

      const preflight =
        trustedPreflight?.reads ??
        (await loadCommandPreflightReads({
          db: this.env.DB,
          command,
          deviceRole: device.role,
          operatorAccountId,
          nowIso: commandNow.toISOString(),
        }));
      let trustedPreflightD1CallCount = trustedPreflight?.d1CallCount ?? 0;
      const preflightResult = this.validatePreflight(command, preflight);
      if (preflightResult instanceof Response) return preflightResult;
      const current = preflightResult;

      const activeOperatorClaim = preflight.activeOperatorClaim;
      // Production commands always carry a session actor. The actor-less branch is retained only
      // for the development integration scaffold, which is already blocked by the public route in
      // every non-development environment.
      const claimError = this.validateActiveOperatorClaim(
        device.role,
        operatorAccountId,
        activeOperatorClaim,
        command,
        preflight.targetRotationAircraftId,
      );
      if (claimError) return claimError;
      if (operatorAccountId && activeOperatorClaim) {
        const renewal = await this.commandPreflight.renewActiveClaim({
          command,
          operatorAccountId,
          claim: activeOperatorClaim,
          now: commandNow,
        });
        if (trustedPreflight) trustedPreflightD1CallCount += renewal.d1CallCount;
      }
      this.commandPreflight.logSlowReads(command.type, preflight, trustedPreflightD1CallCount);

      const commandHandlers = createEventCommandHandlers(
        this.commandServices,
        current,
        operatorAccountId,
        device.role,
      );

      return dispatchRegisteredCommand(commandHandlers, command);
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
    if (this.forecastWork !== null) return this.forecastWork;
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
}
