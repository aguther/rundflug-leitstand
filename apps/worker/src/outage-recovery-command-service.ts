import {
  type CommandEnvelope,
  type CommandResult,
  storedOutageCallPayloadSchema,
  storedOutagePaperSalePayloadSchema,
  storedOutageTransitionPayloadSchema,
} from "@rundflug/contracts";
import {
  assertOutageRecoveryApplication,
  assertOutageRecoveryApproval,
  DomainRuleError,
  type NonCanceledRotationState,
  type RotationState,
  simulateOutageRecovery,
  transitionRotation,
} from "@rundflug/domain";
import { sha256Hex } from "./crypto";
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

function recoveredAircraftState(state: RotationState): "BOARDING" | "IN_FLIGHT" | "LANDED" {
  if (state === "CALLED") return "BOARDING";
  if (state === "IN_FLIGHT") return "IN_FLIGHT";
  return "LANDED";
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
    const [
      products,
      aircraftRows,
      pilotRows,
      existingReferences,
      queueRows,
      communicationRows,
      ticketCommunicationRow,
    ] = await Promise.all([
      this.env.DB.prepare(
        "SELECT id, resource_group_id, gate_id, price_cents FROM products WHERE operation_day_id = ?1",
      )
        .bind(command.eventId)
        .all<{
          id: string;
          resource_group_id: string;
          gate_id: string;
          price_cents: number;
        }>(),
      this.env.DB.prepare(
        `SELECT a.id, a.passenger_seats, a.operational_state, membership.resource_group_id
             FROM aircraft a
             JOIN resource_group_memberships membership
               ON membership.aircraft_id = a.id AND membership.active_until IS NULL
            WHERE membership.operation_day_id = ?1`,
      )
        .bind(command.eventId)
        .all<{
          id: string;
          passenger_seats: number;
          operational_state: string;
          resource_group_id: string;
        }>(),
      this.env.DB.prepare("SELECT id, active, paused FROM pilots WHERE operation_day_id = ?1")
        .bind(command.eventId)
        .all<{ id: string; active: number; paused: number }>(),
      this.env.DB.prepare(
        `SELECT reference.paper_reference, reference.ticket_group_id, reference.rotation_id,
                  reference.current_state, r.aircraft_id, r.pilot_id, fg.resource_group_id,
                  r.version, r.called_at, r.completed_at, COUNT(rt.ticket_id) AS ticket_count
             FROM outage_recovery_references reference
             JOIN rotations r ON r.id = reference.rotation_id
             JOIN flight_groups fg ON fg.id = r.flight_group_id
             LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
            WHERE reference.operation_day_id = ?1
            GROUP BY reference.paper_reference`,
      )
        .bind(command.eventId)
        .all<{
          paper_reference: string;
          ticket_group_id: string;
          rotation_id: string;
          current_state: NonCanceledRotationState;
          aircraft_id: string | null;
          pilot_id: string | null;
          resource_group_id: string;
          version: number;
          ticket_count: number;
          called_at: string | null;
          completed_at: string | null;
        }>(),
      this.env.DB.prepare(
        `SELECT p.resource_group_id, COALESCE(MAX(tg.queue_sequence), 0) AS maximum
             FROM products p
             LEFT JOIN ticket_groups tg ON tg.product_id = p.id AND tg.operation_day_id = p.operation_day_id
            WHERE p.operation_day_id = ?1 GROUP BY p.resource_group_id`,
      )
        .bind(command.eventId)
        .all<{ resource_group_id: string; maximum: number }>(),
      this.env.DB.prepare(
        `SELECT resource_group_id, COALESCE(MAX(communication_number), 100) AS maximum
             FROM flight_groups WHERE operation_day_id = ?1 GROUP BY resource_group_id`,
      )
        .bind(command.eventId)
        .all<{ resource_group_id: string; maximum: number }>(),
      this.env.DB.prepare(
        "SELECT COALESCE(MAX(communication_number), 100) AS maximum FROM ticket_groups WHERE operation_day_id = ?1",
      )
        .bind(command.eventId)
        .first<{ maximum: number }>(),
    ]);
    const productById = new Map(products.results.map((product) => [product.id, product]));
    const aircraftById = new Map(aircraftRows.results.map((aircraft) => [aircraft.id, aircraft]));
    const pilotById = new Map(pilotRows.results.map((pilot) => [pilot.id, pilot]));
    const nextQueue = new Map(queueRows.results.map((row) => [row.resource_group_id, row.maximum]));
    const nextCommunication = new Map(
      communicationRows.results.map((row) => [row.resource_group_id, row.maximum]),
    );
    let nextTicketCommunication = ticketCommunicationRow?.maximum ?? 100;
    type WorkingReference = {
      ticketGroupId: string;
      rotationId: string;
      flightGroupId?: string;
      state: RotationState;
      resourceGroupId: string;
      ticketCount: number;
      rotationVersion: number;
      aircraftId: string | null;
      pilotId: string | null;
      calledAt: string | null;
      completedAt: string | null;
    };
    const references = new Map<string, WorkingReference>(
      existingReferences.results.map((reference) => [
        reference.paper_reference,
        {
          ticketGroupId: reference.ticket_group_id,
          rotationId: reference.rotation_id,
          state: reference.current_state,
          resourceGroupId: reference.resource_group_id,
          ticketCount: reference.ticket_count,
          rotationVersion: reference.version,
          aircraftId: reference.aircraft_id,
          pilotId: reference.pilot_id,
          calledAt: reference.called_at,
          completedAt: reference.completed_at,
        },
      ]),
    );
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
    ];
    const completedRotationsByAircraft = new Map<string, number>();
    const completedReferencesInBatch: WorkingReference[] = [];
    const activeRecoveredAircraft = new Map<string, string>();
    const activeRecoveredPilots = new Map<string, string>();
    try {
      for (const entry of entries.results) {
        if (entry.entry_type === "PAPER_SALE") {
          if (references.has(entry.paper_reference)) {
            throw new DomainRuleError(
              "PAPER_REFERENCE_ALREADY_EXISTS",
              "Die Papier-Belegreferenz wurde bereits angewendet.",
            );
          }
          const payload = storedOutagePaperSalePayloadSchema.parse(JSON.parse(entry.payload_json));
          const product = productById.get(payload.productId);
          if (!product) {
            throw new DomainRuleError(
              "RECOVERY_PRODUCT_NOT_FOUND",
              "Das Produkt des Papierverkaufs ist nicht mehr vorhanden.",
            );
          }
          if (!product.gate_id) {
            throw new DomainRuleError(
              "RECOVERY_PRODUCT_GATE_REQUIRED",
              "Für das Produkt des Papierverkaufs fehlt ein Gate.",
            );
          }
          const queueSequence = (nextQueue.get(product.resource_group_id) ?? 0) + 1;
          nextQueue.set(product.resource_group_id, queueSequence);
          const communicationNumber = (nextCommunication.get(product.resource_group_id) ?? 100) + 1;
          nextCommunication.set(product.resource_group_id, communicationNumber);
          nextTicketCommunication += 1;
          const ticketGroupId = crypto.randomUUID();
          const flightGroupId = crypto.randomUUID();
          const rotationId = crypto.randomUUID();
          const ticketIds = payload.publicTicketCodeHashes.map(() => crypto.randomUUID());
          const reference: WorkingReference = {
            ticketGroupId,
            flightGroupId,
            rotationId,
            state: "DRAFT",
            resourceGroupId: product.resource_group_id,
            ticketCount: ticketIds.length,
            rotationVersion: 0,
            aircraftId: null,
            pilotId: null,
            calledAt: null,
            completedAt: null,
          };
          references.set(entry.paper_reference, reference);
          statements.push(
            this.env.DB.prepare(
              `INSERT INTO ticket_groups
                (id, operation_day_id, product_id, queue_sequence, communication_number, standby,
                 status, sold_at, version, public_status_code_hash)
               VALUES (?1, ?2, ?3, ?4, ?5, 0, 'QUEUED', ?6, 0, ?7)`,
            ).bind(
              ticketGroupId,
              command.eventId,
              product.id,
              queueSequence,
              nextTicketCommunication,
              entry.original_occurred_at,
              payload.publicGroupCodeHash ?? payload.publicTicketCodeHashes[0],
            ),
            this.env.DB.prepare(
              `INSERT INTO flight_groups
                (id, operation_day_id, resource_group_id, product_id, communication_number, status,
                 version, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, 'DRAFT', 0, ?6, ?6)`,
            ).bind(
              flightGroupId,
              command.eventId,
              product.resource_group_id,
              product.id,
              communicationNumber,
              entry.original_occurred_at,
            ),
            this.env.DB.prepare(
              `INSERT INTO rotations
                (id, operation_day_id, flight_group_id, gate_id, status, version, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`,
            ).bind(
              rotationId,
              command.eventId,
              flightGroupId,
              product.gate_id,
              entry.original_occurred_at,
            ),
            this.env.DB.prepare(
              `INSERT INTO outage_recovery_references
                (operation_day_id, paper_reference, ticket_group_id, rotation_id, current_state,
                 last_source_entry_id, created_by_batch_id, updated_at)
               VALUES (?1, ?2, ?3, ?4, 'DRAFT', ?5, ?6, ?7)`,
            ).bind(
              command.eventId,
              entry.paper_reference,
              ticketGroupId,
              rotationId,
              entry.source_entry_id,
              batch.id,
              now,
            ),
          );
          for (let index = 0; index < ticketIds.length; index += 1) {
            statements.push(
              this.env.DB.prepare(
                `INSERT INTO tickets
                  (id, ticket_group_id, public_code_hash, status, weight_class,
                   individual_weight_kg, payment_status, payment_method, price_cents, created_at)
                 VALUES (?1, ?2, ?3, 'QUEUED', 'NOT_CAPTURED', NULL, ?4, ?5, ?6, ?7)`,
              ).bind(
                ticketIds[index],
                ticketGroupId,
                payload.publicTicketCodeHashes[index],
                payload.paymentStatus,
                payload.paymentMethod,
                product.price_cents,
                entry.original_occurred_at,
              ),
              this.env.DB.prepare(
                `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
                 VALUES (?1, ?2, ?3)`,
              ).bind(rotationId, ticketIds[index], entry.original_occurred_at),
            );
          }
          statements.push(
            this.recoveryLedgerStatement({
              eventId: command.eventId,
              eventType: "TICKET_GROUP_SOLD",
              occurredAt: entry.original_occurred_at,
              deviceId: batch.created_by_device_id,
              aggregateType: "TICKET_GROUP",
              aggregateId: ticketGroupId,
              aggregateVersion: 0,
              payload: {
                productId: product.id,
                ticketCount: ticketIds.length,
                rotationId,
              },
              batchId: batch.id,
              paperReference: entry.paper_reference,
            }),
          );
          continue;
        }
        const reference = references.get(entry.paper_reference);
        if (!reference) {
          throw new DomainRuleError(
            "PAPER_REFERENCE_UNKNOWN",
            "Für das Umlaufereignis fehlt ein angewendeter Papierverkauf.",
          );
        }
        const target = {
          ROTATION_CALLED: "CALLED",
          ROTATION_IN_FLIGHT: "IN_FLIGHT",
          ROTATION_LANDED: "LANDED",
          ROTATION_COMPLETED: "COMPLETED",
        } as const;
        const nextState = transitionRotation(reference.state, target[entry.entry_type]);
        if (entry.entry_type === "ROTATION_CALLED") {
          const payload = storedOutageCallPayloadSchema.parse(JSON.parse(entry.payload_json));
          const aircraft = aircraftById.get(payload.aircraftId);
          if (
            aircraft?.resource_group_id !== reference.resourceGroupId ||
            aircraft.passenger_seats < reference.ticketCount
          ) {
            throw new DomainRuleError(
              "RECOVERY_AIRCRAFT_INCOMPATIBLE",
              "Flugzeugzuordnung oder Kapazität passt nicht zum Papierumlauf.",
            );
          }
          if (!pilotById.has(payload.pilotId)) {
            throw new DomainRuleError(
              "RECOVERY_PILOT_NOT_FOUND",
              "Der anonyme Pilotencode des Papierumlaufs ist nicht vorhanden.",
            );
          }
          reference.aircraftId = payload.aircraftId;
          reference.pilotId = payload.pilotId;
        } else {
          storedOutageTransitionPayloadSchema.parse(JSON.parse(entry.payload_json));
        }
        if (!reference.aircraftId || !reference.pilotId) {
          throw new DomainRuleError(
            "RECOVERY_ASSIGNMENT_REQUIRED",
            "Flugzeug- und Pilotenzuordnung fehlen im Papierumlauf.",
          );
        }
        reference.rotationVersion += 1;
        reference.state = nextState;
        if (entry.entry_type === "ROTATION_CALLED") {
          reference.calledAt = entry.original_occurred_at;
        }
        if (entry.entry_type === "ROTATION_COMPLETED") {
          reference.completedAt = entry.original_occurred_at;
        }
        const timestampColumn = {
          ROTATION_CALLED: "called_at",
          ROTATION_IN_FLIGHT: "departed_at",
          ROTATION_LANDED: "landed_at",
          ROTATION_COMPLETED: "completed_at",
        } as const;
        const eventType = {
          ROTATION_CALLED: "FLIGHT_GROUP_CALLED",
          ROTATION_IN_FLIGHT: "ROTATION_STARTED",
          ROTATION_LANDED: "ROTATION_LANDED",
          ROTATION_COMPLETED: "ROTATION_COMPLETED",
        } as const;
        statements.push(
          this.env.DB.prepare(
            `UPDATE rotations SET status = ?1, ${timestampColumn[entry.entry_type]} = ?2,
                    aircraft_id = ?3, pilot_id = ?4, version = version + 1, updated_at = ?5
              WHERE id = ?6 AND version = ?7`,
          ).bind(
            nextState,
            entry.original_occurred_at,
            reference.aircraftId,
            reference.pilotId,
            now,
            reference.rotationId,
            reference.rotationVersion - 1,
          ),
          this.env.DB.prepare(
            `UPDATE tickets SET status = ?1
              WHERE id IN (SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?2 AND released_at IS NULL)`,
          ).bind(nextState, reference.rotationId),
          this.env.DB.prepare(
            `UPDATE outage_recovery_references
                SET current_state = ?1, last_source_entry_id = ?2, updated_at = ?3
              WHERE operation_day_id = ?4 AND paper_reference = ?5`,
          ).bind(nextState, entry.source_entry_id, now, command.eventId, entry.paper_reference),
          this.recoveryLedgerStatement({
            eventId: command.eventId,
            eventType: eventType[entry.entry_type],
            occurredAt: entry.original_occurred_at,
            deviceId: batch.created_by_device_id,
            aggregateType: "ROTATION",
            aggregateId: reference.rotationId,
            aggregateVersion: reference.rotationVersion,
            payload: {
              to: nextState,
              aircraftId: reference.aircraftId,
              pilotId: reference.pilotId,
            },
            batchId: batch.id,
            paperReference: entry.paper_reference,
          }),
        );
        if (nextState === "COMPLETED") {
          completedReferencesInBatch.push(reference);
          completedRotationsByAircraft.set(
            reference.aircraftId,
            (completedRotationsByAircraft.get(reference.aircraftId) ?? 0) + 1,
          );
        }
      }
      const activeRotationIds = new Set(
        [...references.values()]
          .filter((reference) => reference.state !== "COMPLETED" && reference.state !== "DRAFT")
          .map((reference) => reference.rotationId),
      );
      const activeRows = await this.env.DB.prepare(
        `SELECT id, aircraft_id, pilot_id FROM rotations
          WHERE operation_day_id = ?1 AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')`,
      )
        .bind(command.eventId)
        .all<{
          id: string;
          aircraft_id: string | null;
          pilot_id: string | null;
        }>();
      const preexistingActiveRotationIds = new Set(activeRows.results.map((row) => row.id));
      for (const active of activeRows.results) {
        if (activeRotationIds.has(active.id)) continue;
        if (active.aircraft_id) activeRecoveredAircraft.set(active.aircraft_id, active.id);
        if (active.pilot_id) activeRecoveredPilots.set(active.pilot_id, active.id);
      }
      for (const reference of references.values()) {
        if (reference.state === "DRAFT" || reference.state === "COMPLETED") continue;
        if (!reference.aircraftId || !reference.pilotId) continue;
        const aircraftConflict = activeRecoveredAircraft.get(reference.aircraftId);
        const pilotConflict = activeRecoveredPilots.get(reference.pilotId);
        const aircraft = aircraftById.get(reference.aircraftId);
        const pilot = pilotById.get(reference.pilotId);
        if (aircraftConflict && aircraftConflict !== reference.rotationId) {
          throw new DomainRuleError(
            "RECOVERY_AIRCRAFT_CONFLICT",
            "Das Flugzeug ist bereits einem anderen aktiven Umlauf zugeordnet.",
          );
        }
        if (pilotConflict && pilotConflict !== reference.rotationId) {
          throw new DomainRuleError(
            "RECOVERY_PILOT_CONFLICT",
            "Der Pilotencode ist bereits einem anderen aktiven Umlauf zugeordnet.",
          );
        }
        if (
          !aircraft ||
          (!preexistingActiveRotationIds.has(reference.rotationId) &&
            aircraft.operational_state !== "AVAILABLE")
        ) {
          throw new DomainRuleError(
            "RECOVERY_AIRCRAFT_NOT_AVAILABLE",
            "Das Flugzeug ist für den wiederhergestellten aktiven Umlauf nicht verfügbar.",
          );
        }
        if (pilot?.active !== 1 || pilot.paused === 1) {
          throw new DomainRuleError(
            "RECOVERY_PILOT_NOT_AVAILABLE",
            "Der Pilotencode ist für den wiederhergestellten aktiven Umlauf nicht verfügbar.",
          );
        }
        activeRecoveredAircraft.set(reference.aircraftId, reference.rotationId);
        activeRecoveredPilots.set(reference.pilotId, reference.rotationId);
        const aircraftState = recoveredAircraftState(reference.state);
        statements.push(
          this.env.DB.prepare(
            `UPDATE aircraft SET operational_state = ?1,
                    operational_state_changed_at = CASE
                      WHEN operational_state <> ?1 THEN ?2 ELSE operational_state_changed_at END,
                    version = version + 1, updated_at = ?2 WHERE id = ?3`,
          ).bind(aircraftState, now, reference.aircraftId),
        );
      }
      for (const [aircraftId, completedCount] of completedRotationsByAircraft) {
        statements.push(
          this.env.DB.prepare(
            `UPDATE aircraft SET rotations_since_refuel = rotations_since_refuel + ?1,
                    version = version + 1,
                    updated_at = ?2 WHERE id = ?3`,
          ).bind(completedCount, now, aircraftId),
        );
      }
      if (completedReferencesInBatch.length > 0) {
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
            WHERE rule.operation_day_id = ?1 AND rule.status = 'ACTIVE'`,
        )
          .bind(command.eventId)
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
        for (const rule of recurringRules.results) {
          const matching = completedReferencesInBatch.filter((reference) =>
            rule.scope_type === "AIRCRAFT"
              ? reference.aircraftId === rule.scope_id
              : reference.pilotId === rule.scope_id,
          );
          if (matching.length === 0) continue;
          const increment =
            rule.trigger_metric === "COMPLETED_ROTATIONS"
              ? matching.length
              : matching.reduce((sum, reference) => {
                  if (!reference.calledAt || !reference.completedAt) return sum;
                  return (
                    sum +
                    Math.max(
                      0,
                      Math.round(
                        (Date.parse(reference.completedAt) - Date.parse(reference.calledAt)) /
                          60_000,
                      ),
                    )
                  );
                }, 0);
          const progressValue = rule.progress_value + increment;
          const latestReference = matching.toSorted((left, right) =>
            (right.completedAt ?? "").localeCompare(left.completedAt ?? ""),
          )[0];
          const withinOperations =
            !current.operations_end_at ||
            Date.parse(latestReference?.completedAt ?? now) < Date.parse(current.operations_end_at);
          const becomesDue =
            progressValue >= rule.interval_value &&
            rule.open_plan_id === null &&
            Boolean(latestReference) &&
            withinOperations;
          const nextSequence = rule.sequence_number + (becomesDue ? 1 : 0);
          statements.push(
            this.env.DB.prepare(
              `UPDATE recurring_operational_rules
                  SET progress_value = ?1, sequence_number = ?2, version = version + 1,
                      updated_at = ?3
                WHERE id = ?4 AND operation_day_id = ?5 AND version = ?6
                  AND status = 'ACTIVE'`,
            ).bind(progressValue, nextSequence, now, rule.id, command.eventId, rule.version),
          );
          if (!becomesDue || !latestReference) continue;
          const occurrenceId = crypto.randomUUID();
          statements.push(
            this.env.DB.prepare(
              `INSERT INTO planned_operational_constraints
                (id, operation_day_id, scope_type, scope_id, constraint_kind, start_mode,
                 earliest_start_at, latest_start_at, after_rotation_id, effect_mode,
                 duration_multiplier_percent, minimum_duration_minutes, typical_duration_minutes,
                 maximum_duration_minutes, status, reason, public_note, version,
                 created_by_device_id, created_at, updated_at, recurring_rule_id,
                 recurrence_sequence)
               VALUES (?1, ?2, ?3, ?4, ?5, 'AFTER_CURRENT_ROTATION', NULL, NULL, ?6,
                       'BLOCKING', NULL, ?7, ?8, ?9, 'PLANNED', ?10, '', 0, ?11, ?12, ?12,
                       ?13, ?14)`,
            ).bind(
              occurrenceId,
              command.eventId,
              rule.scope_type,
              rule.scope_id,
              rule.operation_kind,
              latestReference.rotationId,
              rule.minimum_duration_minutes,
              rule.typical_duration_minutes,
              rule.maximum_duration_minutes,
              "Wiederkehrende Regel nach bestätigter Nacherfassung fällig.",
              command.deviceId,
              now,
              rule.id,
              nextSequence,
            ),
            this.env.DB.prepare(
              `INSERT INTO operational_events
                (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
                 aggregate_id, aggregate_version, payload_json)
               VALUES (?1, ?2, 'RECURRING_OPERATION_DUE', ?3, ?4, 'OPERATIONAL_RULE',
                       ?5, ?6, ?7)`,
            ).bind(
              crypto.randomUUID(),
              command.eventId,
              latestReference.completedAt ?? now,
              command.deviceId,
              rule.id,
              rule.version + 1,
              JSON.stringify({
                occurrenceId,
                recurrenceSequence: nextSequence,
                afterRotationId: latestReference.rotationId,
                progressValue,
                intervalValue: rule.interval_value,
                triggerMetric: rule.trigger_metric,
                recordedAfterOutage: true,
              }),
            ),
          );
        }
      }
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

  private recoveryLedgerStatement(input: {
    eventId: string;
    eventType: string;
    occurredAt: string;
    deviceId: string;
    aggregateType: "TICKET_GROUP" | "ROTATION";
    aggregateId: string;
    aggregateVersion: number;
    payload: Record<string, unknown>;
    batchId: string;
    paperReference: string;
  }): D1PreparedStatement {
    return this.env.DB.prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json, recorded_after_outage,
         original_occurred_at, recovery_batch_id, paper_reference)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?4, ?10, ?11)`,
    ).bind(
      crypto.randomUUID(),
      input.eventId,
      input.eventType,
      input.occurredAt,
      input.deviceId,
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion,
      JSON.stringify(input.payload),
      input.batchId,
      input.paperReference,
    );
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
