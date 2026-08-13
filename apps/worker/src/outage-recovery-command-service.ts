import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import {
  assertOutageRecoveryApplication,
  assertOutageRecoveryApproval,
  DomainRuleError,
  type NonCanceledRotationState,
  simulateOutageRecovery,
} from "@rundflug/domain";
import { sha256Hex } from "./crypto";
import { buildOutageRecoveryApplicationStatements } from "./outage-recovery-application";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
} as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class OutageRecoveryCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handleApplyOutageRecovery(
    command: Extract<CommandEnvelope, { type: "APPLY_OUTAGE_RECOVERY" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const batch = await this.env.DB.prepare(
      `SELECT id, status, created_by_device_id, approved_by_device_id,
              simulated_against_version, version
         FROM outage_recovery_batches
        WHERE id = ?1 AND operation_day_id = ?2`,
    )
      .bind(command.payload.batchId, command.eventId)
      .first<{
        id: string;
        status: "STAGED" | "CONFLICTED" | "APPROVED" | "APPLYING" | "APPLIED" | "REJECTED";
        created_by_device_id: string;
        approved_by_device_id: string | null;
        simulated_against_version: number;
        version: number;
      }>();
    if (!batch) {
      return json(
        {
          error: {
            code: "RECOVERY_BATCH_NOT_FOUND",
            message: "Nacherfassungsbatch nicht gefunden.",
          },
        },
        { status: 404 },
      );
    }
    try {
      assertOutageRecoveryApplication({
        status: batch.status,
        simulatedAgainstVersion: batch.simulated_against_version,
        currentEventVersion: current.version,
      });
    } catch (reason) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    const entries = await this.env.DB.prepare(
      `SELECT id, source_entry_id, entry_type, original_occurred_at, paper_sequence,
              paper_reference, payload_json, status
         FROM outage_recovery_entries
        WHERE batch_id = ?1
        ORDER BY original_occurred_at, paper_sequence, id`,
    )
      .bind(batch.id)
      .all<{
        id: string;
        source_entry_id: string;
        entry_type:
          | "PAPER_SALE"
          | "ROTATION_CALLED"
          | "ROTATION_IN_FLIGHT"
          | "ROTATION_LANDED"
          | "ROTATION_COMPLETED";
        original_occurred_at: string;
        paper_sequence: number;
        paper_reference: string;
        payload_json: string;
        status: "STAGED" | "CONFLICT" | "APPLIED";
      }>();
    if (
      entries.results.length === 0 ||
      entries.results.some((entry) => entry.status !== "STAGED")
    ) {
      return json(
        {
          error: {
            code: "RECOVERY_ENTRIES_NOT_APPLICABLE",
            message: "Der Batch enthält keine vollständig freigegebenen Nacherfassungszeilen.",
          },
        },
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    let statements: D1PreparedStatement[];
    try {
      statements = await buildOutageRecoveryApplicationStatements({
        env: this.env,
        command,
        current,
        batch,
        entries: entries.results,
        now,
        nextVersion,
      });
    } catch (reason) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      return json(
        {
          error: {
            code: "RECOVERY_PAYLOAD_INVALID",
            message: "Gespeicherte Nacherfassungsdaten sind ungültig; Anwendung wurde abgebrochen.",
          },
        },
        { status: 409 },
      );
    }
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        version: nextVersion,
        updated_at: now,
      }),
      eventType: "OUTAGE_RECOVERY_APPLIED",
      aggregate: { type: "RECOVERY_BATCH", id: batch.id },
    };
    statements.push(
      this.env.DB.prepare(
        "UPDATE outage_recovery_entries SET status = 'APPLIED' WHERE batch_id = ?1 AND status = 'STAGED'",
      ).bind(batch.id),
      this.env.DB.prepare(
        `UPDATE outage_recovery_batches SET status = 'APPLIED', applied_at = ?1,
                version = version + 1 WHERE id = ?2 AND version = ?3 AND status = 'APPROVED'`,
      ).bind(now, batch.id, batch.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'OUTAGE_RECOVERY_APPLIED', ?3, ?4, 'RECOVERY_BATCH', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        batch.id,
        batch.version + 1,
        JSON.stringify({
          entryCount: entries.results.length,
          createdByDeviceId: batch.created_by_device_id,
          approvedByDeviceId: batch.approved_by_device_id,
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
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }

  async handleApproveOutageRecovery(
    command: Extract<CommandEnvelope, { type: "APPROVE_OUTAGE_RECOVERY" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const batch = await this.env.DB.prepare(
      `SELECT id, status, created_by_device_id, simulated_against_version, version
         FROM outage_recovery_batches
        WHERE id = ?1 AND operation_day_id = ?2`,
    )
      .bind(command.payload.batchId, command.eventId)
      .first<{
        id: string;
        status: "STAGED" | "CONFLICTED" | "APPROVED" | "APPLYING" | "APPLIED" | "REJECTED";
        created_by_device_id: string;
        simulated_against_version: number;
        version: number;
      }>();
    if (!batch) {
      return json(
        {
          error: {
            code: "RECOVERY_BATCH_NOT_FOUND",
            message: "Nacherfassungsbatch nicht gefunden.",
          },
        },
        { status: 404 },
      );
    }
    try {
      assertOutageRecoveryApproval({
        status: batch.status,
        createdByDeviceId: batch.created_by_device_id,
        approvedByDeviceId: command.deviceId,
        simulatedAgainstVersion: batch.simulated_against_version,
        currentEventVersion: current.version,
      });
    } catch (reason) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        version: nextVersion,
        updated_at: now,
      }),
      eventType: "OUTAGE_RECOVERY_APPROVED",
      aggregate: { type: "RECOVERY_BATCH", id: batch.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE outage_recovery_batches
            SET status = 'APPROVED', approved_by_device_id = ?1, approved_at = ?2,
                version = version + 1
          WHERE id = ?3 AND version = ?4 AND status = 'STAGED'`,
      ).bind(command.deviceId, now, batch.id, batch.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'OUTAGE_RECOVERY_APPROVED', ?3, ?4, 'RECOVERY_BATCH', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        batch.id,
        batch.version + 1,
        JSON.stringify({
          createdByDeviceId: batch.created_by_device_id,
          simulatedAgainstVersion: batch.simulated_against_version,
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
    ]);
    this.broadcast(result);
    return json(result);
  }

  async handleStageOutageRecovery(
    command: Extract<CommandEnvelope, { type: "STAGE_OUTAGE_RECOVERY" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const existingBatch = await this.env.DB.prepare(
      "SELECT id FROM outage_recovery_batches WHERE id = ?1",
    )
      .bind(command.payload.batchId)
      .first<{ id: string }>();
    if (existingBatch) {
      return json(
        {
          error: {
            code: "RECOVERY_BATCH_ALREADY_EXISTS",
            message: "Der Nacherfassungsbatch existiert bereits.",
          },
        },
        { status: 409 },
      );
    }
    const existingReferences = await this.env.DB.prepare(
      `SELECT DISTINCT ore.paper_reference
         FROM outage_recovery_entries ore
         JOIN outage_recovery_batches orb ON orb.id = ore.batch_id
        WHERE orb.operation_day_id = ?1 AND orb.status <> 'REJECTED'`,
    )
      .bind(command.eventId)
      .all<{ paper_reference: string }>();
    const existingTicketKeys = await this.env.DB.prepare(
      `SELECT t.public_code_hash
         FROM tickets t
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
        WHERE tg.operation_day_id = ?1`,
    )
      .bind(command.eventId)
      .all<{ public_code_hash: string }>();
    const appliedRecoveryReferences = await this.env.DB.prepare(
      `SELECT paper_reference, current_state
         FROM outage_recovery_references
        WHERE operation_day_id = ?1`,
    )
      .bind(command.eventId)
      .all<{
        paper_reference: string;
        current_state: NonCanceledRotationState;
      }>();
    const appliedReferenceStates: Record<string, NonCanceledRotationState> = {};
    for (const entry of appliedRecoveryReferences.results) {
      appliedReferenceStates[entry.paper_reference] = entry.current_state;
    }
    const preparedEntries = await Promise.all(
      command.payload.entries.map(async (entry) => {
        const ticketKeys =
          entry.type === "PAPER_SALE"
            ? await Promise.all(entry.payload.publicTicketCodes.map(sha256Hex))
            : [];
        const groupCodeHash =
          entry.type === "PAPER_SALE"
            ? await sha256Hex(
                entry.payload.publicGroupCode ?? entry.payload.publicTicketCodes[0] ?? "",
              )
            : undefined;
        return {
          entry,
          ticketKeys,
          storedPayload:
            entry.type === "PAPER_SALE"
              ? {
                  productId: entry.payload.productId,
                  publicGroupCodeHash: groupCodeHash,
                  publicTicketCodeHashes: ticketKeys,
                  paymentStatus: entry.payload.paymentStatus,
                  paymentMethod: entry.payload.paymentMethod,
                }
              : entry.payload,
        };
      }),
    );
    const now = new Date().toISOString();
    const simulation = simulateOutageRecovery({
      entries: preparedEntries.map(({ entry, ticketKeys }) => ({
        id: entry.id,
        type: entry.type,
        originalOccurredAt: entry.originalOccurredAt,
        paperSequence: entry.paperSequence,
        paperReference: entry.paperReference,
        ticketKeys,
      })),
      existingPaperReferences: existingReferences.results.map((row) => row.paper_reference),
      existingReferenceStates: appliedReferenceStates,
      existingTicketKeys: existingTicketKeys.results.map((row) => row.public_code_hash),
      recordedAt: now,
    });
    const nextVersion = current.version + 1;
    const eventType = simulation.canCommit
      ? "OUTAGE_RECOVERY_STAGED"
      : "OUTAGE_RECOVERY_CONFLICTED";
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        version: nextVersion,
        updated_at: now,
      }),
      eventType,
      aggregate: { type: "RECOVERY_BATCH", id: command.payload.batchId },
    };
    const simulationPayload = {
      batchId: command.payload.batchId,
      simulatedAgainstVersion: current.version,
      canCommit: simulation.canCommit,
      orderedEntryIds: simulation.orderedEntries.map((entry) => entry.id),
      conflicts: simulation.conflicts,
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `INSERT INTO outage_recovery_batches
          (id, operation_day_id, created_by_device_id, created_at, simulated_against_version,
           status, simulation_json, version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)`,
      ).bind(
        command.payload.batchId,
        command.eventId,
        command.deviceId,
        now,
        current.version,
        simulation.canCommit ? "STAGED" : "CONFLICTED",
        JSON.stringify(simulationPayload),
      ),
    ];
    for (const { entry, storedPayload } of preparedEntries) {
      const entryConflicts = simulation.conflicts.filter(
        (conflict) => conflict.entryId === entry.id,
      );
      statements.push(
        this.env.DB.prepare(
          `INSERT INTO outage_recovery_entries
            (id, source_entry_id, batch_id, entry_type, original_occurred_at, paper_sequence,
             paper_reference, payload_json, status, conflict_json)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        ).bind(
          crypto.randomUUID(),
          entry.id,
          command.payload.batchId,
          entry.type,
          entry.originalOccurredAt,
          entry.paperSequence,
          entry.paperReference,
          JSON.stringify(storedPayload),
          entryConflicts.length === 0 ? "STAGED" : "CONFLICT",
          entryConflicts.length === 0 ? null : JSON.stringify(entryConflicts),
        ),
      );
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'RECOVERY_BATCH', ?6, 0, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        command.payload.batchId,
        JSON.stringify({
          entryCount: command.payload.entries.length,
          conflictCount: simulation.conflicts.length,
          simulatedAgainstVersion: current.version,
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
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }
}
