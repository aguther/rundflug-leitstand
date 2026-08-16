import {
  type ForecastHistory,
  type ForecastHistoryQuery,
  forecastHistorySchema,
  type OperationalHistory,
  type OperationalHistoryQuery,
  operationalHistorySchema,
  type ResourceDayHistory,
  type ResourceDayHistoryQuery,
  resourceDayHistorySchema,
} from "@rundflug/contracts";
import { formatFlightGroupLabel } from "@rundflug/domain";
import { buildEventDayWindow } from "./admin-event-flow";
import { buildForecastHistoryStatement } from "./forecast-history";
import { buildOperationalHistoryStatement } from "./operational-history";
import {
  buildAircraftBlockStatement,
  buildPilotPauseEventStatement,
  buildResourceDayRotationStatement,
  pairPilotPauseEvents,
} from "./resource-day-history";

export interface AuditHistoryFilters {
  eventType?: string | undefined;
  aggregateType?: string | undefined;
  aggregateId?: string | undefined;
  deviceId?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  limit?: string | undefined;
}

export interface AuditHistory {
  entries: Array<{
    sequence: number;
    eventType: string;
    occurredAt: string;
    deviceId: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    payload: Record<string, unknown>;
  }>;
}

export async function loadAuditHistory(
  database: D1Database,
  eventId: string,
  filters: AuditHistoryFilters,
): Promise<AuditHistory> {
  const conditions = ["operation_day_id = ?1"];
  const bindings: Array<string | number> = [eventId];
  const addFilter = (column: string, value: string | undefined) => {
    if (!value?.trim()) return;
    bindings.push(value.trim());
    conditions.push(`${column} = ?${bindings.length}`);
  };
  addFilter("event_type", filters.eventType);
  addFilter("aggregate_type", filters.aggregateType);
  addFilter("aggregate_id", filters.aggregateId);
  addFilter("device_id", filters.deviceId);
  if (filters.since && !Number.isNaN(Date.parse(filters.since))) {
    bindings.push(new Date(filters.since).toISOString());
    conditions.push(`occurred_at >= ?${bindings.length}`);
  }
  if (filters.until && !Number.isNaN(Date.parse(filters.until))) {
    bindings.push(new Date(filters.until).toISOString());
    conditions.push(`occurred_at <= ?${bindings.length}`);
  }
  const requestedLimit = Number.parseInt(filters.limit ?? "200", 10);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 200, 1), 1000);
  bindings.push(limit);
  const rows = await database
    .prepare(
      `SELECT sequence, event_type, occurred_at, device_id, aggregate_type, aggregate_id,
              aggregate_version, payload_json
         FROM operational_events WHERE ${conditions.join(" AND ")}
        ORDER BY sequence DESC LIMIT ?${bindings.length}`,
    )
    .bind(...bindings)
    .all<{
      sequence: number;
      event_type: string;
      occurred_at: string;
      device_id: string;
      aggregate_type: string;
      aggregate_id: string;
      aggregate_version: number;
      payload_json: string;
    }>();
  return {
    entries: rows.results.map((row) => ({
      sequence: row.sequence,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      deviceId: row.device_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      aggregateVersion: row.aggregate_version,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    })),
  };
}

export async function loadOperationalHistory(
  database: D1Database,
  eventId: string,
  query: OperationalHistoryQuery,
): Promise<OperationalHistory> {
  const statement = buildOperationalHistoryStatement(eventId, query);
  const rows = await database
    .prepare(statement.sql)
    .bind(...statement.bindings)
    .all<{
      ticket_id: string;
      ticket_group_id: string;
      ticket_status: string;
      sold_at: string;
      assigned_at: string | null;
      released_at: string | null;
      rotation_id: string | null;
      rotation_status: string | null;
      flight_group_id: string | null;
      communication_number: number | null;
      resource_group_short_code: string | null;
      product_id: string;
      product_code: string;
      product_name: string;
      resource_group_id: string;
      resource_group_name: string;
      gate_id: string | null;
      gate_label: string | null;
      aircraft_id: string | null;
      aircraft_registration: string | null;
      pilot_id: string | null;
      pilot_operational_code: string | null;
      called_at: string | null;
      departed_at: string | null;
      landed_at: string | null;
      completed_at: string | null;
      latest_at: string;
      total_count: number;
    }>();
  return operationalHistorySchema.parse({
    entries: rows.results.map((row) => ({
      ticketId: row.ticket_id,
      ticketGroupId: row.ticket_group_id,
      ticketStatus: row.ticket_status,
      soldAt: row.sold_at,
      assignmentActive: row.assigned_at !== null && row.released_at === null,
      assignedAt: row.assigned_at,
      releasedAt: row.released_at,
      rotationId: row.rotation_id,
      rotationStatus: row.rotation_status,
      flightGroupId: row.flight_group_id,
      communicationNumber: row.communication_number,
      communicationLabel:
        row.communication_number === null || row.resource_group_short_code === null
          ? null
          : formatFlightGroupLabel(row.resource_group_short_code, row.communication_number),
      productId: row.product_id,
      productCode: row.product_code,
      productName: row.product_name,
      resourceGroupId: row.resource_group_id,
      resourceGroupName: row.resource_group_name,
      gateId: row.gate_id,
      gateLabel: row.gate_label,
      aircraftId: row.aircraft_id,
      aircraftRegistration: row.aircraft_registration,
      pilotId: row.pilot_id,
      pilotOperationalCode: row.pilot_operational_code,
      calledAt: row.called_at,
      departedAt: row.departed_at,
      landedAt: row.landed_at,
      completedAt: row.completed_at,
      latestAt: row.latest_at,
    })),
    total: rows.results[0]?.total_count ?? 0,
    limit: query.limit,
    offset: query.offset,
  });
}

export async function loadForecastHistory(
  database: D1Database,
  eventId: string,
  query: ForecastHistoryQuery,
): Promise<ForecastHistory> {
  const statement = buildForecastHistoryStatement(eventId, query);
  const rows = await database
    .prepare(statement.sql)
    .bind(...statement.bindings)
    .all<{
      snapshot_id: string;
      rotation_id: string;
      flight_group_id: string;
      communication_number: number;
      resource_group_short_code: string;
      aircraft_id: string | null;
      aircraft_registration: string | null;
      pilot_id: string | null;
      pilot_operational_code: string | null;
      operation_day_version: number;
      captured_at: string;
      trigger_event_type: string;
      quality: string;
      lower_minutes: number;
      upper_minutes: number;
      data_basis_scope: string;
      sample_size: number;
      data_age_minutes: number;
      active_capacity: number;
      reference_duration_minutes: number;
      product_id: string | null;
      assumed_aircraft_id: string | null;
      boarding_minutes: number | null;
      deboarding_minutes: number | null;
      buffer_minutes: number | null;
      boarding_source: string;
      deboarding_source: string;
      buffer_source: string;
      dispatch_plan_id: string | null;
      dispatch_plan_revision: string | null;
      dispatch_batch_id: string | null;
      dispatch_order: number | null;
      dispatch_wave: number | null;
      dispatch_lane_id: string | null;
      dispatch_group_ids_json: string;
      dispatch_occupied_seats: number | null;
      dispatch_available_seats: number | null;
      dispatch_commitment_level: "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE" | null;
      dispatch_decision_reasons_json: string;
      dispatch_decision_details_json: string | null;
      dispatch_confirmed_overtake_count: number;
      dispatch_projected_overtake_count: number;
      dispatch_unplanned_reason:
        | "NO_FORECAST_CAPACITY"
        | "WAITING_FOR_FITTING_LANE"
        | "WAITING_FOR_PRODUCT_FAIRNESS"
        | "NOT_IN_NEAR_DISPATCH_BATCH"
        | "COMMITMENT_LOCKED"
        | "ATTENDANCE_MISSING"
        | "ATTENDANCE_CLARIFICATION"
        | "UNKNOWN_RESOURCE_RETURN"
        | null;
      predicted_boarding_at: string | null;
      predicted_departure_at: string | null;
      predicted_landing_at: string | null;
      predicted_completion_at: string | null;
      called_at: string | null;
      departed_at: string | null;
      landed_at: string | null;
      completed_at: string | null;
      boarding_deviation_minutes: number | null;
      departure_deviation_minutes: number | null;
      landing_deviation_minutes: number | null;
      completion_deviation_minutes: number | null;
      total_count: number;
    }>();
  return forecastHistorySchema.parse({
    entries: rows.results.map((row) => ({
      snapshotId: row.snapshot_id,
      rotationId: row.rotation_id,
      flightGroupId: row.flight_group_id,
      communicationNumber: row.communication_number,
      communicationLabel: formatFlightGroupLabel(
        row.resource_group_short_code,
        row.communication_number,
      ),
      aircraftId: row.aircraft_id,
      aircraftRegistration: row.aircraft_registration,
      pilotId: row.pilot_id,
      pilotOperationalCode: row.pilot_operational_code,
      operationDayVersion: row.operation_day_version,
      capturedAt: row.captured_at,
      triggerEventType: row.trigger_event_type,
      quality: row.quality,
      lowerMinutes: row.lower_minutes,
      upperMinutes: row.upper_minutes,
      dataBasisScope: row.data_basis_scope,
      sampleSize: row.sample_size,
      dataAgeMinutes: row.data_age_minutes,
      activeCapacity: row.active_capacity,
      referenceDurationMinutes: row.reference_duration_minutes,
      productId: row.product_id,
      assumedAircraftId: row.assumed_aircraft_id,
      turnaroundProfile: {
        boardingMinutes: row.boarding_minutes,
        deboardingMinutes: row.deboarding_minutes,
        bufferMinutes: row.buffer_minutes,
        boardingSource: row.boarding_source,
        deboardingSource: row.deboarding_source,
        bufferSource: row.buffer_source,
      },
      dispatchPlan: {
        planId: row.dispatch_plan_id,
        revision: row.dispatch_plan_revision,
        batchId: row.dispatch_batch_id,
        dispatchOrder: row.dispatch_order,
        wave: row.dispatch_wave,
        laneId: row.dispatch_lane_id,
        groupIds: JSON.parse(row.dispatch_group_ids_json) as string[],
        occupiedSeats: row.dispatch_occupied_seats,
        availableSeats: row.dispatch_available_seats,
        commitmentLevel: row.dispatch_commitment_level,
        decisionReasons: JSON.parse(row.dispatch_decision_reasons_json) as string[],
        decisionDetails: row.dispatch_decision_details_json
          ? (JSON.parse(row.dispatch_decision_details_json) as Record<string, number>)
          : null,
        confirmedOvertakeCount: row.dispatch_confirmed_overtake_count,
        projectedOvertakeCount: row.dispatch_projected_overtake_count,
        unplannedReason: row.dispatch_unplanned_reason,
      },
      predicted: {
        boardingAt: row.predicted_boarding_at,
        departureAt: row.predicted_departure_at,
        landingAt: row.predicted_landing_at,
        completionAt: row.predicted_completion_at,
      },
      actual: {
        boardingAt: row.called_at,
        departureAt: row.departed_at,
        landingAt: row.landed_at,
        completionAt: row.completed_at,
      },
      deviationMinutes: {
        boarding: row.boarding_deviation_minutes,
        departure: row.departure_deviation_minutes,
        landing: row.landing_deviation_minutes,
        completion: row.completion_deviation_minutes,
      },
    })),
    total: rows.results[0]?.total_count ?? 0,
    limit: query.limit,
    offset: query.offset,
  });
}

export type ResourceDayHistoryResult =
  | { status: "READY"; history: ResourceDayHistory }
  | { status: "EVENT_NOT_FOUND" }
  | { status: "RESOURCE_NOT_FOUND" };

export async function loadResourceDayHistory(
  database: D1Database,
  eventId: string,
  query: ResourceDayHistoryQuery,
  observedAt = new Date().toISOString(),
): Promise<ResourceDayHistoryResult> {
  const event = await database
    .prepare(
      `SELECT event_date, time_zone, sale_opens_at, operations_start_at, operations_end_at
         FROM operation_days
        WHERE id = ?1`,
    )
    .bind(eventId)
    .first<{
      event_date: string;
      time_zone: string;
      sale_opens_at: string | null;
      operations_start_at: string | null;
      operations_end_at: string | null;
    }>();
  if (!event) return { status: "EVENT_NOT_FOUND" };

  const resource =
    query.scopeType === "AIRCRAFT"
      ? await database
          .prepare(
            `SELECT a.id
               FROM aircraft a
              WHERE a.id = ?1
                AND EXISTS (
                  SELECT 1
                    FROM resource_group_memberships rgm
                   WHERE rgm.operation_day_id = ?2 AND rgm.aircraft_id = a.id
                )`,
          )
          .bind(query.scopeId, eventId)
          .first<{ id: string }>()
      : await database
          .prepare("SELECT id FROM pilots WHERE id = ?1 AND operation_day_id = ?2")
          .bind(query.scopeId, eventId)
          .first<{ id: string }>();
  if (!resource) return { status: "RESOURCE_NOT_FOUND" };

  const window = buildEventDayWindow({
    eventDate: event.event_date,
    timeZone: event.time_zone,
    saleOpensAt: event.sale_opens_at,
    operationsStartAt: event.operations_start_at,
    operationsEndAt: event.operations_end_at,
    observedAt,
  });
  const rotationStatement = buildResourceDayRotationStatement(
    eventId,
    query,
    window.from,
    window.observedUntil,
  );
  const rotations = await database
    .prepare(rotationStatement.sql)
    .bind(...rotationStatement.bindings)
    .all<{
      rotation_id: string;
      flight_group_id: string;
      communication_number: number;
      resource_group_id: string;
      resource_group_name: string;
      resource_group_short_code: string;
      product_name: string;
      passenger_count: number;
      usable_capacity: number;
      aircraft_id: string | null;
      aircraft_registration: string | null;
      pilot_id: string | null;
      pilot_operational_code: string | null;
      called_at: string | null;
      departed_at: string | null;
      landed_at: string | null;
      completed_at: string | null;
    }>();

  let blocks: ResourceDayHistory["blocks"];
  if (query.scopeType === "AIRCRAFT") {
    const statement = buildAircraftBlockStatement(
      eventId,
      query.scopeId,
      window.from,
      window.observedUntil,
    );
    const rows = await database
      .prepare(statement.sql)
      .bind(...statement.bindings)
      .all<{
        id: string;
        block_type: "REFUELING" | "PAUSE" | "INTERRUPTION";
        status: "ACTIVE" | "CLEARED";
        started_at: string;
        cleared_at: string | null;
      }>();
    const fromMs = Date.parse(window.from);
    const observedUntilMs = Date.parse(window.observedUntil);
    blocks = rows.results.map((row) => ({
      id: row.id,
      type: row.block_type,
      startedAt: new Date(Math.max(Date.parse(row.started_at), fromMs)).toISOString(),
      endedAt: row.cleared_at
        ? new Date(Math.min(Date.parse(row.cleared_at), observedUntilMs)).toISOString()
        : null,
      active: row.status === "ACTIVE" && row.cleared_at === null,
    }));
  } else {
    const statement = buildPilotPauseEventStatement(eventId, query.scopeId, window.observedUntil);
    const rows = await database
      .prepare(statement.sql)
      .bind(...statement.bindings)
      .all<{
        id: string;
        sequence: number;
        event_type: "PILOT_PAUSE_STARTED" | "PILOT_PAUSE_ENDED";
        occurred_at: string;
      }>();
    blocks = pairPilotPauseEvents(
      rows.results.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
      })),
      window.from,
      window.observedUntil,
    );
  }

  return {
    status: "READY",
    history: resourceDayHistorySchema.parse({
      scopeType: query.scopeType,
      scopeId: query.scopeId,
      from: window.from,
      until: window.until,
      observedUntil: window.observedUntil,
      rotations: rotations.results.map((row) => ({
        rotationId: row.rotation_id,
        flightGroupId: row.flight_group_id,
        communicationNumber: row.communication_number,
        communicationLabel: formatFlightGroupLabel(
          row.resource_group_short_code,
          row.communication_number,
        ),
        resourceGroupId: row.resource_group_id,
        resourceGroupName: row.resource_group_name,
        productName: row.product_name,
        passengerCount: row.passenger_count,
        usableCapacity: row.usable_capacity,
        aircraftId: row.aircraft_id,
        aircraftRegistration: row.aircraft_registration,
        pilotId: row.pilot_id,
        pilotOperationalCode: row.pilot_operational_code,
        actual: {
          boardingAt: row.called_at,
          departureAt: row.departed_at,
          landingAt: row.landed_at,
          completionAt: row.completed_at,
        },
      })),
      blocks,
    }),
  };
}
