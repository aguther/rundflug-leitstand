import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import type { DeviceRole } from "@rundflug/domain";
import {
  automaticArchiveRequestStatements,
  processPendingAnalysisArchives,
} from "./analysis-archive";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class EventAdministrationCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
    private readonly waitUntil: (promise: Promise<unknown>) => void,
    private readonly getForecastWork: () => Promise<void> | null,
  ) {}

  async handleLifecycle(
    command: Extract<CommandEnvelope, { type: "SET_EVENT_LIFECYCLE" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const target = command.payload.status;
    const allowedTransitions: Record<StoredEventRow["status"], StoredEventRow["status"][]> = {
      PREPARATION: ["ACTIVE"],
      ACTIVE: ["CLOSED"],
      CLOSED: ["ACTIVE", "ARCHIVED"],
      ARCHIVED: [],
    };
    if (target === current.status) {
      return json(
        { error: { code: "EVENT_STATUS_UNCHANGED", message: "Der Status ist bereits gesetzt." } },
        { status: 409 },
      );
    }
    if (!allowedTransitions[current.status].includes(target)) {
      return json(
        {
          error: {
            code: "EVENT_LIFECYCLE_TRANSITION_NOT_ALLOWED",
            message: `Übergang ${current.status} → ${target} ist nicht zulässig.`,
          },
        },
        { status: 409 },
      );
    }
    if (target === "ACTIVE") {
      const readiness = await this.env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM products WHERE operation_day_id = ?1) AS products,
          (SELECT COUNT(*) FROM resource_groups WHERE operation_day_id = ?1 AND status = 'ACTIVE') AS resource_groups,
          (SELECT COUNT(*) FROM resource_group_memberships WHERE operation_day_id = ?1 AND active_until IS NULL) AS aircraft,
          (SELECT COUNT(*) FROM pilots WHERE operation_day_id = ?1 AND active = 1) AS pilots,
          (SELECT COUNT(*) FROM gates WHERE operation_day_id = ?1 AND active = 1) AS gates`,
      )
        .bind(command.eventId)
        .first<{
          products: number;
          resource_groups: number;
          aircraft: number;
          pilots: number;
          gates: number;
        }>();
      if (
        !current.operations_end_at ||
        !readiness ||
        [
          readiness.products,
          readiness.resource_groups,
          readiness.aircraft,
          readiness.pilots,
          readiness.gates,
        ].some((count) => count < 1)
      ) {
        return json(
          {
            error: {
              code: "EVENT_NOT_READY",
              message:
                "Vor Aktivierung sind Betriebsende, Produkt, Ressourcengruppe, Flugzeug, Pilot und Gate erforderlich.",
            },
          },
          { status: 409 },
        );
      }
    }
    if (target === "CLOSED" || target === "ARCHIVED") {
      const open = await this.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM rotations
          WHERE operation_day_id = ?1 AND status NOT IN ('COMPLETED', 'CANCELED')`,
      )
        .bind(command.eventId)
        .first<{ count: number }>();
      if ((open?.count ?? 0) > 0) {
        return json(
          {
            error: {
              code: "EVENT_HAS_OPEN_ROTATIONS",
              message:
                "Offene Fluggruppen oder Umläufe müssen vor dem Schließen abgeschlossen werden.",
            },
          },
          { status: 409 },
        );
      }
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const archivedAt = target === "ARCHIVED" ? now : null;
    const eventType = `EVENT_${target}`;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        status: target,
        archived_at: archivedAt,
        version: nextVersion,
        updated_at: now,
      }),
      eventType,
      aggregate: { type: "OPERATION_DAY", id: command.eventId },
    };
    const archiveStatements =
      target === "CLOSED"
        ? await automaticArchiveRequestStatements({
            env: this.env,
            eventId: command.eventId,
            eventVersion: nextVersion,
            requestedAt: now,
          })
        : [];
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE operation_days SET status = ?1, archived_at = ?2, version = ?3, updated_at = ?4
          WHERE id = ?5 AND version = ?6`,
      ).bind(target, archivedAt, nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'OPERATION_DAY', ?2, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        nextVersion,
        JSON.stringify({
          previousStatus: current.status,
          status: target,
          reason: command.payload.reason,
        }),
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
      ...archiveStatements,
    ]);
    this.broadcast(result);
    if (target === "CLOSED") {
      const forecastWork = this.getForecastWork() ?? Promise.resolve();
      this.waitUntil(forecastWork.then(() => processPendingAnalysisArchives(this.env, 1)));
    }
    return json(result);
  }

  async handleParameters(
    command: Extract<CommandEnvelope, { type: "CONFIGURE_EVENT_PARAMETERS" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const payload = command.payload;
    if (
      payload.saleOpensAt &&
      Date.parse(payload.saleOpensAt) >= Date.parse(payload.operationsEndAt)
    ) {
      return json(
        {
          error: {
            code: "EVENT_TIME_RANGE_INVALID",
            message: "Der Verkaufsbeginn muss vor dem Betriebsende liegen.",
          },
        },
        { status: 409 },
      );
    }
    if (
      payload.operationsStartAt &&
      Date.parse(payload.operationsStartAt) >= Date.parse(payload.operationsEndAt)
    ) {
      return json(
        {
          error: {
            code: "EVENT_TIME_RANGE_INVALID",
            message: "Der Betriebsbeginn muss vor dem Betriebsende liegen.",
          },
        },
        { status: 409 },
      );
    }
    if (
      !(
        payload.childReferenceWeightKg < payload.normalReferenceWeightKg &&
        payload.normalReferenceWeightKg < payload.heavyReferenceWeightKg
      )
    ) {
      return json(
        {
          error: {
            code: "REFERENCE_WEIGHTS_INVALID",
            message: "Referenzgewichte müssen in der Reihenfolge Kind, Normal, Schwer ansteigen.",
          },
        },
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        version: nextVersion,
        sale_opens_at: payload.saleOpensAt,
        operations_start_at: payload.operationsStartAt,
        operations_end_at: payload.operationsEndAt,
        no_show_after_minutes: payload.noShowAfterMinutes,
        max_ticket_deferrals: payload.maxTicketDeferrals,
        notification_lead_minutes: payload.notificationLeadMinutes,
        automatic_precall_enabled: payload.automaticPrecallEnabled ? 1 : 0,
        precall_lead_minutes: payload.precallLeadMinutes,
        max_gate_wait_minutes: payload.maximumGateWaitMinutes,
        precall_min_quality: payload.precallMinimumQuality,
        precall_gate_cooldown_minutes: payload.precallGateCooldownMinutes,
        child_reference_weight_kg: payload.childReferenceWeightKg,
        normal_reference_weight_kg: payload.normalReferenceWeightKg,
        heavy_reference_weight_kg: payload.heavyReferenceWeightKg,
        planned_boarding_minutes: payload.plannedBoardingMinutes,
        planned_deboarding_minutes: payload.plannedDeboardingMinutes,
        planned_buffer_minutes: payload.plannedBufferMinutes,
        departed_visibility_seconds: payload.departedVisibilitySeconds,
        updated_at: now,
      }),
      eventType: "EVENT_PARAMETERS_CONFIGURED",
      aggregate: { type: "OPERATION_DAY", id: current.id },
    };
    const auditPayload = {
      saleOpensAt: payload.saleOpensAt,
      operationsStartAt: payload.operationsStartAt,
      operationsEndAt: payload.operationsEndAt,
      noShowAfterMinutes: payload.noShowAfterMinutes,
      maxTicketDeferrals: payload.maxTicketDeferrals,
      notificationLeadMinutes: payload.notificationLeadMinutes,
      automaticPrecallEnabled: payload.automaticPrecallEnabled,
      precallLeadMinutes: payload.precallLeadMinutes,
      maximumGateWaitMinutes: payload.maximumGateWaitMinutes,
      precallMinimumQuality: payload.precallMinimumQuality,
      precallGateCooldownMinutes: payload.precallGateCooldownMinutes,
      referenceWeightsKg: {
        child: payload.childReferenceWeightKg,
        normal: payload.normalReferenceWeightKg,
        heavy: payload.heavyReferenceWeightKg,
      },
      plannedBoardingMinutes: payload.plannedBoardingMinutes,
      plannedDeboardingMinutes: payload.plannedDeboardingMinutes,
      plannedBufferMinutes: payload.plannedBufferMinutes,
      departedVisibilitySeconds: payload.departedVisibilitySeconds,
      reason: payload.reason,
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE operation_days SET sale_opens_at = ?1, operations_start_at = ?2,
          operations_end_at = ?3, no_show_after_minutes = ?4, max_ticket_deferrals = ?5,
          notification_lead_minutes = ?6, automatic_precall_enabled = ?7,
          precall_lead_minutes = ?8, max_gate_wait_minutes = ?9, precall_min_quality = ?10,
          precall_gate_cooldown_minutes = ?11,
          child_reference_weight_kg = ?12, normal_reference_weight_kg = ?13,
          heavy_reference_weight_kg = ?14, planned_boarding_minutes = ?15,
          planned_deboarding_minutes = ?16, planned_buffer_minutes = ?17,
          departed_visibility_seconds = ?18,
          version = ?19, updated_at = ?20 WHERE id = ?21 AND version = ?22`,
      ).bind(
        payload.saleOpensAt,
        payload.operationsStartAt,
        payload.operationsEndAt,
        payload.noShowAfterMinutes,
        payload.maxTicketDeferrals,
        payload.notificationLeadMinutes,
        payload.automaticPrecallEnabled ? 1 : 0,
        payload.precallLeadMinutes,
        payload.maximumGateWaitMinutes,
        payload.precallMinimumQuality,
        payload.precallGateCooldownMinutes,
        payload.childReferenceWeightKg,
        payload.normalReferenceWeightKg,
        payload.heavyReferenceWeightKg,
        payload.plannedBoardingMinutes,
        payload.plannedDeboardingMinutes,
        payload.plannedBufferMinutes,
        payload.departedVisibilitySeconds,
        nextVersion,
        now,
        command.eventId,
        current.version,
      ),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'EVENT_PARAMETERS_CONFIGURED', ?3, ?4, 'OPERATION_DAY', ?2, ?5, ?6)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        nextVersion,
        JSON.stringify(auditPayload),
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

  async handleDevices(
    command: Extract<CommandEnvelope, { type: "PAIR_DEVICE" | "REVOKE_DEVICE" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const targetId = command.payload.pairedDeviceId;
    if (command.type === "REVOKE_DEVICE") {
      const target = await this.env.DB.prepare(
        "SELECT id, role, active FROM paired_devices WHERE id = ?1 AND operation_day_id = ?2",
      )
        .bind(targetId, command.eventId)
        .first<{ id: string; role: DeviceRole; active: number }>();
      if (!target) {
        return json(
          { error: { code: "DEVICE_NOT_FOUND", message: "Gerät nicht gefunden." } },
          { status: 404 },
        );
      }
      if (target.role === "ADMIN" && target.active === 1) {
        const admins = await this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM paired_devices WHERE operation_day_id = ?1 AND role = 'ADMIN' AND active = 1",
        )
          .bind(command.eventId)
          .first<{ count: number }>();
        if ((admins?.count ?? 0) <= 1) {
          return json(
            {
              error: {
                code: "LAST_ADMIN_DEVICE",
                message: "Die letzte aktive Administrationssitzung kann nicht widerrufen werden.",
              },
            },
            { status: 409 },
          );
        }
      }
    } else {
      const existing = await this.env.DB.prepare("SELECT id FROM paired_devices WHERE id = ?1")
        .bind(targetId)
        .first<{ id: string }>();
      if (existing) {
        return json(
          { error: { code: "DEVICE_ID_EXISTS", message: "Sitzungskennung ist bereits vergeben." } },
          { status: 409 },
        );
      }
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType = command.type === "PAIR_DEVICE" ? "DEVICE_PAIRED" : "DEVICE_REVOKED";
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate: { type: "DEVICE", id: targetId },
    };
    const deviceMutation =
      command.type === "PAIR_DEVICE"
        ? this.env.DB.prepare(
            `INSERT INTO paired_devices
              (id, operation_day_id, label, role, active, paired_at, last_seen_at, credential_hash)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, '1970-01-01T00:00:00.000Z', ?6)`,
          ).bind(
            targetId,
            command.eventId,
            command.payload.label,
            command.payload.role,
            now,
            command.payload.credentialHash,
          )
        : this.env.DB.prepare(
            `UPDATE paired_devices SET active = 0, revoked_at = ?1, credential_hash = NULL
              WHERE id = ?2 AND operation_day_id = ?3`,
          ).bind(now, targetId, command.eventId);
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      deviceMutation,
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'DEVICE', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        targetId,
        nextVersion,
        JSON.stringify(
          command.type === "PAIR_DEVICE"
            ? { label: command.payload.label, role: command.payload.role }
            : { reason: command.payload.reason },
        ),
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
}
