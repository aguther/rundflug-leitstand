import { DurableObject } from "cloudflare:workers";
import {
  type CommandEnvelope,
  type CommandResult,
  commandEnvelopeSchema,
  commandResultSchema,
} from "@rundflug/contracts";
import {
  assertMayStageOutageRecoveryEntry,
  assertPublicTicketCode,
  assertRoleMayExecute,
  assertSaleAllowed,
  type DeviceRole,
  DomainRuleError,
  formatBookingGroupLabel,
  type OperationalCommandType,
  planBookingGroupSplit,
} from "@rundflug/domain";
import {
  type AnalysisSnapshotCaptureInput,
  type AnalysisSnapshotCaptureResult,
  AnalysisSnapshotCaptureService,
} from "./analysis-snapshot-capture-service";
import { AssistClaimService } from "./assist-claim-service";
import { AttendanceCommandService } from "./attendance-command-service";
import {
  loadCommandPreflightReads,
  type PlannedOperationRow,
  plannedOperationExpectation,
  scopedCommandTarget,
} from "./command-preflight";
import { CoordinatorRealtimeService } from "./coordinator-realtime-service";
import { sha256Hex, verifyCredential } from "./crypto";
import { DispatchRecommendationLeaseService } from "./dispatch-recommendation-lease-service";
import { EventAdministrationCommandService } from "./event-administration-command-service";
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
import { rowToSnapshot, safeErrorMessage } from "./snapshot";
import { TicketGroupMutationCommandService } from "./ticket-group-mutation-command-service";
import { TicketGroupRecallPersistenceService } from "./ticket-group-recall-persistence-service";
import type { Env, StoredEventRow } from "./types";

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
          return this.rotationNoteCommands.handle(command, current);
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
          return this.rotationTransitionCommands.handle(command, current, operatorAccountId);
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

      return this.operationalNoteCommands.handle(command, current);
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
}
