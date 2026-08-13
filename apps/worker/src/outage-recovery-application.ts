import {
  type CommandEnvelope,
  storedOutageCallPayloadSchema,
  storedOutagePaperSalePayloadSchema,
  storedOutageTransitionPayloadSchema,
} from "@rundflug/contracts";
import {
  DomainRuleError,
  type NonCanceledRotationState,
  type RotationState,
  transitionRotation,
} from "@rundflug/domain";
import type { Env, StoredEventRow } from "./types";

type ApplyOutageRecoveryCommand = Extract<CommandEnvelope, { type: "APPLY_OUTAGE_RECOVERY" }>;

export type ApprovedRecoveryBatch = {
  id: string;
  created_by_device_id: string;
  approved_by_device_id: string | null;
  version: number;
};

export type StagedRecoveryEntry = {
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
};

type RotationRecoveryEntry = StagedRecoveryEntry & {
  entry_type: Exclude<StagedRecoveryEntry["entry_type"], "PAPER_SALE">;
};

type ProductRow = {
  id: string;
  resource_group_id: string;
  gate_id: string;
  price_cents: number;
};

type AircraftRow = {
  id: string;
  passenger_seats: number;
  operational_state: string;
  resource_group_id: string;
};

type PilotRow = { id: string; active: number; paused: number };

type ExistingReferenceRow = {
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
};

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

type RecurringRuleRow = {
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
};

type ApplicationInput = {
  env: Env;
  command: ApplyOutageRecoveryCommand;
  current: StoredEventRow;
  batch: ApprovedRecoveryBatch;
  entries: readonly StagedRecoveryEntry[];
  now: string;
  nextVersion: number;
};

type ApplicationContext = {
  products: ProductRow[];
  aircraft: AircraftRow[];
  pilots: PilotRow[];
  references: ExistingReferenceRow[];
  queueMaximums: Array<{ resource_group_id: string; maximum: number }>;
  communicationMaximums: Array<{ resource_group_id: string; maximum: number }>;
  ticketCommunicationMaximum: number;
};

export async function buildOutageRecoveryApplicationStatements(
  input: ApplicationInput,
): Promise<D1PreparedStatement[]> {
  const context = await loadApplicationContext(input.env, input.command.eventId);
  const application = new OutageRecoveryApplication(input, context);
  return application.apply();
}

async function loadApplicationContext(env: Env, eventId: string): Promise<ApplicationContext> {
  const [products, aircraft, pilots, references, queueRows, communicationRows, ticketRow] =
    await Promise.all([
      env.DB.prepare(
        "SELECT id, resource_group_id, gate_id, price_cents FROM products WHERE operation_day_id = ?1",
      )
        .bind(eventId)
        .all<ProductRow>(),
      env.DB.prepare(
        `SELECT a.id, a.passenger_seats, a.operational_state, membership.resource_group_id
           FROM aircraft a
           JOIN resource_group_memberships membership
             ON membership.aircraft_id = a.id AND membership.active_until IS NULL
          WHERE membership.operation_day_id = ?1`,
      )
        .bind(eventId)
        .all<AircraftRow>(),
      env.DB.prepare("SELECT id, active, paused FROM pilots WHERE operation_day_id = ?1")
        .bind(eventId)
        .all<PilotRow>(),
      env.DB.prepare(
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
        .bind(eventId)
        .all<ExistingReferenceRow>(),
      env.DB.prepare(
        `SELECT p.resource_group_id, COALESCE(MAX(tg.queue_sequence), 0) AS maximum
           FROM products p
           LEFT JOIN ticket_groups tg ON tg.product_id = p.id AND tg.operation_day_id = p.operation_day_id
          WHERE p.operation_day_id = ?1 GROUP BY p.resource_group_id`,
      )
        .bind(eventId)
        .all<{ resource_group_id: string; maximum: number }>(),
      env.DB.prepare(
        `SELECT resource_group_id, COALESCE(MAX(communication_number), 100) AS maximum
           FROM flight_groups WHERE operation_day_id = ?1 GROUP BY resource_group_id`,
      )
        .bind(eventId)
        .all<{ resource_group_id: string; maximum: number }>(),
      env.DB.prepare(
        "SELECT COALESCE(MAX(communication_number), 100) AS maximum FROM ticket_groups WHERE operation_day_id = ?1",
      )
        .bind(eventId)
        .first<{ maximum: number }>(),
    ]);
  return {
    products: products.results,
    aircraft: aircraft.results,
    pilots: pilots.results,
    references: references.results,
    queueMaximums: queueRows.results,
    communicationMaximums: communicationRows.results,
    ticketCommunicationMaximum: ticketRow?.maximum ?? 100,
  };
}

class OutageRecoveryApplication {
  private readonly productById: Map<string, ProductRow>;
  private readonly aircraftById: Map<string, AircraftRow>;
  private readonly pilotById: Map<string, PilotRow>;
  private readonly references: Map<string, WorkingReference>;
  private readonly nextQueue: Map<string, number>;
  private readonly nextCommunication: Map<string, number>;
  private nextTicketCommunication: number;
  private readonly statements: D1PreparedStatement[];
  private readonly completedRotationsByAircraft = new Map<string, number>();
  private readonly completedReferences: WorkingReference[] = [];

  constructor(
    private readonly input: ApplicationInput,
    context: ApplicationContext,
  ) {
    this.productById = new Map(context.products.map((product) => [product.id, product]));
    this.aircraftById = new Map(context.aircraft.map((aircraft) => [aircraft.id, aircraft]));
    this.pilotById = new Map(context.pilots.map((pilot) => [pilot.id, pilot]));
    this.references = new Map(
      context.references.map((reference) => [
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
    this.nextQueue = new Map(
      context.queueMaximums.map((row) => [row.resource_group_id, row.maximum]),
    );
    this.nextCommunication = new Map(
      context.communicationMaximums.map((row) => [row.resource_group_id, row.maximum]),
    );
    this.nextTicketCommunication = context.ticketCommunicationMaximum;
    this.statements = [
      input.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(input.nextVersion, input.now, input.command.eventId, input.current.version),
    ];
  }

  async apply(): Promise<D1PreparedStatement[]> {
    for (const entry of this.input.entries) this.applyEntry(entry);
    await this.appendActiveAircraftStatements();
    this.appendCompletedAircraftCounters();
    await this.appendRecurringRuleStatements();
    return this.statements;
  }

  private applyEntry(entry: StagedRecoveryEntry): void {
    if (entry.entry_type === "PAPER_SALE") {
      this.applyPaperSale(entry);
      return;
    }
    this.applyRotationTransition(entry as RotationRecoveryEntry);
  }

  private applyPaperSale(entry: StagedRecoveryEntry): void {
    if (this.references.has(entry.paper_reference)) {
      throw new DomainRuleError(
        "PAPER_REFERENCE_ALREADY_EXISTS",
        "Die Papier-Belegreferenz wurde bereits angewendet.",
      );
    }
    const payload = storedOutagePaperSalePayloadSchema.parse(JSON.parse(entry.payload_json));
    const product = this.productById.get(payload.productId);
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
    const ids = this.createPaperSaleReference(
      entry,
      product,
      payload.publicTicketCodeHashes.length,
    );
    this.appendPaperSaleStatements(entry, product, payload, ids);
  }

  private createPaperSaleReference(
    entry: StagedRecoveryEntry,
    product: ProductRow,
    ticketCount: number,
  ): {
    queueSequence: number;
    communicationNumber: number;
    ticketGroupId: string;
    flightGroupId: string;
    rotationId: string;
    ticketIds: string[];
  } {
    const queueSequence = (this.nextQueue.get(product.resource_group_id) ?? 0) + 1;
    this.nextQueue.set(product.resource_group_id, queueSequence);
    const communicationNumber = (this.nextCommunication.get(product.resource_group_id) ?? 100) + 1;
    this.nextCommunication.set(product.resource_group_id, communicationNumber);
    this.nextTicketCommunication += 1;
    const ticketGroupId = crypto.randomUUID();
    const flightGroupId = crypto.randomUUID();
    const rotationId = crypto.randomUUID();
    const ticketIds = Array.from({ length: ticketCount }, () => crypto.randomUUID());
    this.references.set(entry.paper_reference, {
      ticketGroupId,
      flightGroupId,
      rotationId,
      state: "DRAFT",
      resourceGroupId: product.resource_group_id,
      ticketCount,
      rotationVersion: 0,
      aircraftId: null,
      pilotId: null,
      calledAt: null,
      completedAt: null,
    });
    return {
      queueSequence,
      communicationNumber,
      ticketGroupId,
      flightGroupId,
      rotationId,
      ticketIds,
    };
  }

  private appendPaperSaleStatements(
    entry: StagedRecoveryEntry,
    product: ProductRow,
    payload: ReturnType<typeof storedOutagePaperSalePayloadSchema.parse>,
    ids: ReturnType<OutageRecoveryApplication["createPaperSaleReference"]>,
  ): void {
    const { command, batch, now } = this.input;
    this.statements.push(
      this.input.env.DB.prepare(
        `INSERT INTO ticket_groups
          (id, operation_day_id, product_id, queue_sequence, communication_number, standby,
           status, sold_at, version, public_status_code_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 'QUEUED', ?6, 0, ?7)`,
      ).bind(
        ids.ticketGroupId,
        command.eventId,
        product.id,
        ids.queueSequence,
        this.nextTicketCommunication,
        entry.original_occurred_at,
        payload.publicGroupCodeHash ?? payload.publicTicketCodeHashes[0],
      ),
      this.input.env.DB.prepare(
        `INSERT INTO flight_groups
          (id, operation_day_id, resource_group_id, product_id, communication_number, status,
           version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'DRAFT', 0, ?6, ?6)`,
      ).bind(
        ids.flightGroupId,
        command.eventId,
        product.resource_group_id,
        product.id,
        ids.communicationNumber,
        entry.original_occurred_at,
      ),
      this.input.env.DB.prepare(
        `INSERT INTO rotations
          (id, operation_day_id, flight_group_id, gate_id, status, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`,
      ).bind(
        ids.rotationId,
        command.eventId,
        ids.flightGroupId,
        product.gate_id,
        entry.original_occurred_at,
      ),
      this.input.env.DB.prepare(
        `INSERT INTO outage_recovery_references
          (operation_day_id, paper_reference, ticket_group_id, rotation_id, current_state,
           last_source_entry_id, created_by_batch_id, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'DRAFT', ?5, ?6, ?7)`,
      ).bind(
        command.eventId,
        entry.paper_reference,
        ids.ticketGroupId,
        ids.rotationId,
        entry.source_entry_id,
        batch.id,
        now,
      ),
    );
    this.appendTicketStatements(entry, product, payload, ids);
    this.statements.push(
      this.recoveryLedgerStatement({
        eventType: "TICKET_GROUP_SOLD",
        occurredAt: entry.original_occurred_at,
        aggregateType: "TICKET_GROUP",
        aggregateId: ids.ticketGroupId,
        aggregateVersion: 0,
        payload: {
          productId: product.id,
          ticketCount: ids.ticketIds.length,
          rotationId: ids.rotationId,
        },
        paperReference: entry.paper_reference,
      }),
    );
  }

  private appendTicketStatements(
    entry: StagedRecoveryEntry,
    product: ProductRow,
    payload: ReturnType<typeof storedOutagePaperSalePayloadSchema.parse>,
    ids: ReturnType<OutageRecoveryApplication["createPaperSaleReference"]>,
  ): void {
    for (let index = 0; index < ids.ticketIds.length; index += 1) {
      this.statements.push(
        this.input.env.DB.prepare(
          `INSERT INTO tickets
            (id, ticket_group_id, public_code_hash, status, weight_class,
             individual_weight_kg, payment_status, payment_method, price_cents, created_at)
           VALUES (?1, ?2, ?3, 'QUEUED', 'NOT_CAPTURED', NULL, ?4, ?5, ?6, ?7)`,
        ).bind(
          ids.ticketIds[index],
          ids.ticketGroupId,
          payload.publicTicketCodeHashes[index],
          payload.paymentStatus,
          payload.paymentMethod,
          product.price_cents,
          entry.original_occurred_at,
        ),
        this.input.env.DB.prepare(
          `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
           VALUES (?1, ?2, ?3)`,
        ).bind(ids.rotationId, ids.ticketIds[index], entry.original_occurred_at),
      );
    }
  }

  private applyRotationTransition(entry: RotationRecoveryEntry): void {
    const reference = this.references.get(entry.paper_reference);
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
    this.applyTransitionAssignment(entry, reference);
    assertReferenceAssignment(reference);
    this.advanceReference(entry, reference, nextState);
    this.appendTransitionStatements(entry, reference, nextState);
    this.captureCompletedReference(reference, nextState);
  }

  private applyTransitionAssignment(
    entry: RotationRecoveryEntry,
    reference: WorkingReference,
  ): void {
    if (entry.entry_type !== "ROTATION_CALLED") {
      storedOutageTransitionPayloadSchema.parse(JSON.parse(entry.payload_json));
      return;
    }
    const payload = storedOutageCallPayloadSchema.parse(JSON.parse(entry.payload_json));
    const aircraft = this.aircraftById.get(payload.aircraftId);
    if (
      aircraft?.resource_group_id !== reference.resourceGroupId ||
      aircraft.passenger_seats < reference.ticketCount
    ) {
      throw new DomainRuleError(
        "RECOVERY_AIRCRAFT_INCOMPATIBLE",
        "Flugzeugzuordnung oder Kapazität passt nicht zum Papierumlauf.",
      );
    }
    if (!this.pilotById.has(payload.pilotId)) {
      throw new DomainRuleError(
        "RECOVERY_PILOT_NOT_FOUND",
        "Der anonyme Pilotencode des Papierumlaufs ist nicht vorhanden.",
      );
    }
    reference.aircraftId = payload.aircraftId;
    reference.pilotId = payload.pilotId;
  }

  private advanceReference(
    entry: RotationRecoveryEntry,
    reference: WorkingReference,
    nextState: RotationState,
  ): void {
    reference.rotationVersion += 1;
    reference.state = nextState;
    if (entry.entry_type === "ROTATION_CALLED") reference.calledAt = entry.original_occurred_at;
    if (entry.entry_type === "ROTATION_COMPLETED") {
      reference.completedAt = entry.original_occurred_at;
    }
  }

  private appendTransitionStatements(
    entry: RotationRecoveryEntry,
    reference: WorkingReference & { aircraftId: string; pilotId: string },
    nextState: RotationState,
  ): void {
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
    const { command, now } = this.input;
    this.statements.push(
      this.input.env.DB.prepare(
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
      this.input.env.DB.prepare(
        `UPDATE tickets SET status = ?1
          WHERE id IN (SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?2 AND released_at IS NULL)`,
      ).bind(nextState, reference.rotationId),
      this.input.env.DB.prepare(
        `UPDATE outage_recovery_references
            SET current_state = ?1, last_source_entry_id = ?2, updated_at = ?3
          WHERE operation_day_id = ?4 AND paper_reference = ?5`,
      ).bind(nextState, entry.source_entry_id, now, command.eventId, entry.paper_reference),
      this.recoveryLedgerStatement({
        eventType: eventType[entry.entry_type],
        occurredAt: entry.original_occurred_at,
        aggregateType: "ROTATION",
        aggregateId: reference.rotationId,
        aggregateVersion: reference.rotationVersion,
        payload: {
          to: nextState,
          aircraftId: reference.aircraftId,
          pilotId: reference.pilotId,
        },
        paperReference: entry.paper_reference,
      }),
    );
  }

  private captureCompletedReference(reference: WorkingReference, nextState: RotationState): void {
    if (nextState !== "COMPLETED" || !reference.aircraftId) return;
    this.completedReferences.push(reference);
    this.completedRotationsByAircraft.set(
      reference.aircraftId,
      (this.completedRotationsByAircraft.get(reference.aircraftId) ?? 0) + 1,
    );
  }

  private async appendActiveAircraftStatements(): Promise<void> {
    const activeReferences = [...this.references.values()].filter(
      (reference) => reference.state !== "COMPLETED" && reference.state !== "DRAFT",
    );
    const activeRotationIds = new Set(activeReferences.map((reference) => reference.rotationId));
    const activeRows = await this.input.env.DB.prepare(
      `SELECT id, aircraft_id, pilot_id FROM rotations
        WHERE operation_day_id = ?1 AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')`,
    )
      .bind(this.input.command.eventId)
      .all<{ id: string; aircraft_id: string | null; pilot_id: string | null }>();
    const preexistingActiveRotationIds = new Set(activeRows.results.map((row) => row.id));
    const activeAircraft = new Map<string, string>();
    const activePilots = new Map<string, string>();
    for (const active of activeRows.results) {
      if (activeRotationIds.has(active.id)) continue;
      if (active.aircraft_id) activeAircraft.set(active.aircraft_id, active.id);
      if (active.pilot_id) activePilots.set(active.pilot_id, active.id);
    }
    for (const reference of activeReferences) {
      this.appendActiveReferenceStatement(
        reference,
        preexistingActiveRotationIds,
        activeAircraft,
        activePilots,
      );
    }
  }

  private appendActiveReferenceStatement(
    reference: WorkingReference,
    preexistingActiveRotationIds: ReadonlySet<string>,
    activeAircraft: Map<string, string>,
    activePilots: Map<string, string>,
  ): void {
    if (!reference.aircraftId || !reference.pilotId) return;
    assertReferenceAssignment(reference);
    this.assertRecoveredAssignmentAvailable(
      reference,
      preexistingActiveRotationIds,
      activeAircraft,
      activePilots,
    );
    activeAircraft.set(reference.aircraftId, reference.rotationId);
    activePilots.set(reference.pilotId, reference.rotationId);
    this.statements.push(
      this.input.env.DB.prepare(
        `UPDATE aircraft SET operational_state = ?1,
                operational_state_changed_at = CASE
                  WHEN operational_state <> ?1 THEN ?2 ELSE operational_state_changed_at END,
                version = version + 1, updated_at = ?2 WHERE id = ?3`,
      ).bind(recoveredAircraftState(reference.state), this.input.now, reference.aircraftId),
    );
  }

  private assertRecoveredAssignmentAvailable(
    reference: WorkingReference & { aircraftId: string; pilotId: string },
    preexistingActiveRotationIds: ReadonlySet<string>,
    activeAircraft: ReadonlyMap<string, string>,
    activePilots: ReadonlyMap<string, string>,
  ): void {
    const aircraftConflict = activeAircraft.get(reference.aircraftId);
    if (aircraftConflict && aircraftConflict !== reference.rotationId) {
      throw new DomainRuleError(
        "RECOVERY_AIRCRAFT_CONFLICT",
        "Das Flugzeug ist bereits einem anderen aktiven Umlauf zugeordnet.",
      );
    }
    const pilotConflict = activePilots.get(reference.pilotId);
    if (pilotConflict && pilotConflict !== reference.rotationId) {
      throw new DomainRuleError(
        "RECOVERY_PILOT_CONFLICT",
        "Der Pilotencode ist bereits einem anderen aktiven Umlauf zugeordnet.",
      );
    }
    const aircraft = this.aircraftById.get(reference.aircraftId);
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
    const pilot = this.pilotById.get(reference.pilotId);
    if (pilot?.active !== 1 || pilot.paused === 1) {
      throw new DomainRuleError(
        "RECOVERY_PILOT_NOT_AVAILABLE",
        "Der Pilotencode ist für den wiederhergestellten aktiven Umlauf nicht verfügbar.",
      );
    }
  }

  private appendCompletedAircraftCounters(): void {
    for (const [aircraftId, completedCount] of this.completedRotationsByAircraft) {
      this.statements.push(
        this.input.env.DB.prepare(
          `UPDATE aircraft SET rotations_since_refuel = rotations_since_refuel + ?1,
                  version = version + 1,
                  updated_at = ?2 WHERE id = ?3`,
        ).bind(completedCount, this.input.now, aircraftId),
      );
    }
  }

  private async appendRecurringRuleStatements(): Promise<void> {
    if (this.completedReferences.length === 0) return;
    const recurringRules = await this.input.env.DB.prepare(
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
      .bind(this.input.command.eventId)
      .all<RecurringRuleRow>();
    for (const rule of recurringRules.results) this.appendRecurringRule(rule);
  }

  private appendRecurringRule(rule: RecurringRuleRow): void {
    const matching = this.completedReferences.filter((reference) =>
      matchesRecurringRule(reference, rule),
    );
    if (matching.length === 0) return;
    const increment = recurringProgressIncrement(rule.trigger_metric, matching);
    const progressValue = rule.progress_value + increment;
    const latestReference = matching.toSorted((left, right) =>
      (right.completedAt ?? "").localeCompare(left.completedAt ?? ""),
    )[0];
    const becomesDue = this.recurringRuleBecomesDue(rule, progressValue, latestReference);
    const nextSequence = rule.sequence_number + (becomesDue ? 1 : 0);
    this.statements.push(
      this.input.env.DB.prepare(
        `UPDATE recurring_operational_rules
            SET progress_value = ?1, sequence_number = ?2, version = version + 1,
                updated_at = ?3
          WHERE id = ?4 AND operation_day_id = ?5 AND version = ?6
            AND status = 'ACTIVE'`,
      ).bind(
        progressValue,
        nextSequence,
        this.input.now,
        rule.id,
        this.input.command.eventId,
        rule.version,
      ),
    );
    if (becomesDue && latestReference) {
      this.appendRecurringOccurrence(rule, latestReference, progressValue, nextSequence);
    }
  }

  private recurringRuleBecomesDue(
    rule: RecurringRuleRow,
    progressValue: number,
    latestReference: WorkingReference | undefined,
  ): boolean {
    const withinOperations =
      !this.input.current.operations_end_at ||
      Date.parse(latestReference?.completedAt ?? this.input.now) <
        Date.parse(this.input.current.operations_end_at);
    return (
      progressValue >= rule.interval_value &&
      rule.open_plan_id === null &&
      Boolean(latestReference) &&
      withinOperations
    );
  }

  private appendRecurringOccurrence(
    rule: RecurringRuleRow,
    reference: WorkingReference,
    progressValue: number,
    nextSequence: number,
  ): void {
    const occurrenceId = crypto.randomUUID();
    const { command, now } = this.input;
    this.statements.push(
      this.input.env.DB.prepare(
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
        reference.rotationId,
        rule.minimum_duration_minutes,
        rule.typical_duration_minutes,
        rule.maximum_duration_minutes,
        "Wiederkehrende Regel nach bestätigter Nacherfassung fällig.",
        command.deviceId,
        now,
        rule.id,
        nextSequence,
      ),
      this.input.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'RECURRING_OPERATION_DUE', ?3, ?4, 'OPERATIONAL_RULE',
                 ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        reference.completedAt ?? now,
        command.deviceId,
        rule.id,
        rule.version + 1,
        JSON.stringify({
          occurrenceId,
          recurrenceSequence: nextSequence,
          afterRotationId: reference.rotationId,
          progressValue,
          intervalValue: rule.interval_value,
          triggerMetric: rule.trigger_metric,
          recordedAfterOutage: true,
        }),
      ),
    );
  }

  private recoveryLedgerStatement(input: {
    eventType: string;
    occurredAt: string;
    aggregateType: "TICKET_GROUP" | "ROTATION";
    aggregateId: string;
    aggregateVersion: number;
    payload: Record<string, unknown>;
    paperReference: string;
  }): D1PreparedStatement {
    const { command, batch } = this.input;
    return this.input.env.DB.prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json, recorded_after_outage,
         original_occurred_at, recovery_batch_id, paper_reference)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?4, ?10, ?11)`,
    ).bind(
      crypto.randomUUID(),
      command.eventId,
      input.eventType,
      input.occurredAt,
      batch.created_by_device_id,
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion,
      JSON.stringify(input.payload),
      batch.id,
      input.paperReference,
    );
  }
}

function recoveredAircraftState(state: RotationState): "BOARDING" | "IN_FLIGHT" | "LANDED" {
  if (state === "CALLED") return "BOARDING";
  if (state === "IN_FLIGHT") return "IN_FLIGHT";
  return "LANDED";
}

function assertReferenceAssignment(
  reference: WorkingReference,
): asserts reference is WorkingReference & { aircraftId: string; pilotId: string } {
  if (reference.aircraftId && reference.pilotId) return;
  throw new DomainRuleError(
    "RECOVERY_ASSIGNMENT_REQUIRED",
    "Flugzeug- und Pilotenzuordnung fehlen im Papierumlauf.",
  );
}

function matchesRecurringRule(reference: WorkingReference, rule: RecurringRuleRow): boolean {
  if (rule.scope_type === "AIRCRAFT") return reference.aircraftId === rule.scope_id;
  return reference.pilotId === rule.scope_id;
}

function recurringProgressIncrement(
  triggerMetric: RecurringRuleRow["trigger_metric"],
  references: readonly WorkingReference[],
): number {
  if (triggerMetric === "COMPLETED_ROTATIONS") return references.length;
  return references.reduce((sum, reference) => sum + operatingMinutes(reference), 0);
}

function operatingMinutes(reference: WorkingReference): number {
  if (!reference.calledAt || !reference.completedAt) return 0;
  return Math.max(
    0,
    Math.round((Date.parse(reference.completedAt) - Date.parse(reference.calledAt)) / 60_000),
  );
}
