import { compareTechnicalStrings as order } from "@rundflug/domain";
import { dailyReportCsv, dailyReportPdfLines, loadDailyReport } from "./daily-report";
import { createCsv, createTextPdf } from "./report";

export type GeneratedReportResult<T> = { status: "READY"; body: T } | { status: "EVENT_NOT_FOUND" };
export async function generateDailyReportCsv(
  database: D1Database,
  eventId: string,
): Promise<GeneratedReportResult<string>> {
  const report = await loadDailyReport(database, eventId);
  return report ? { status: "READY", body: dailyReportCsv(report) } : { status: "EVENT_NOT_FOUND" };
}

export async function generateDailyReportPdf(
  database: D1Database,
  eventId: string,
): Promise<GeneratedReportResult<Uint8Array>> {
  const report = await loadDailyReport(database, eventId);
  return report
    ? {
        status: "READY",
        body: createTextPdf(`Tagesbericht ${report.summary.name}`, dailyReportPdfLines(report)),
      }
    : { status: "EVENT_NOT_FOUND" };
}

export interface PerformanceProfile {
  schemaVersion: 1;
  exportedAt: string;
  context: {
    eventName: string;
    eventDate: string;
    aerodrome: string;
    timeZone: string;
  };
  planningDefaults: {
    boardingMinutes: number;
    deboardingMinutes: number;
    bufferMinutes: number;
  };
  resourceGroups: Array<{
    id: string;
    name: string;
    completedRotations: number;
    aircraftTypes: string[];
    passengerSeatCounts: number[];
    durationsMinutes: {
      boarding: number | null;
      flight: number | null;
      turnaround: number | null;
    };
  }>;
}

export async function loadPerformanceProfile(
  database: D1Database,
  eventId: string,
  exportedAt = new Date().toISOString(),
): Promise<GeneratedReportResult<PerformanceProfile>> {
  const event = await database
    .prepare(
      `SELECT name, event_date, aerodrome, time_zone, planned_boarding_minutes,
              planned_deboarding_minutes, planned_buffer_minutes
         FROM operation_days WHERE id = ?1`,
    )
    .bind(eventId)
    .first<{
      name: string;
      event_date: string;
      aerodrome: string;
      time_zone: string;
      planned_boarding_minutes: number;
      planned_deboarding_minutes: number;
      planned_buffer_minutes: number;
    }>();
  if (!event) return { status: "EVENT_NOT_FOUND" };

  const groups = await database
    .prepare(
      `SELECT rg.id AS resource_group_id, rg.name AS resource_group_name,
              COUNT(DISTINCT CASE WHEN r.status = 'COMPLETED' THEN r.id END) AS completed_rotations,
              ROUND(AVG(CASE WHEN r.departed_at IS NOT NULL AND r.called_at IS NOT NULL
                THEN (julianday(r.departed_at) - julianday(r.called_at)) * 1440 END), 1)
                AS average_boarding_minutes,
              ROUND(AVG(CASE WHEN r.landed_at IS NOT NULL AND r.departed_at IS NOT NULL
                THEN (julianday(r.landed_at) - julianday(r.departed_at)) * 1440 END), 1)
                AS average_flight_minutes,
              ROUND(AVG(CASE WHEN r.completed_at IS NOT NULL AND r.landed_at IS NOT NULL
                THEN (julianday(r.completed_at) - julianday(r.landed_at)) * 1440 END), 1)
                AS average_turnaround_minutes,
              GROUP_CONCAT(DISTINCT a.aircraft_type) AS aircraft_types,
              GROUP_CONCAT(DISTINCT a.passenger_seats) AS passenger_seat_counts
         FROM resource_groups rg
         LEFT JOIN flight_groups fg ON fg.resource_group_id = rg.id
         LEFT JOIN rotations r ON r.flight_group_id = fg.id
         LEFT JOIN resource_group_memberships m
           ON m.resource_group_id = rg.id AND m.operation_day_id = rg.operation_day_id
         LEFT JOIN aircraft a ON a.id = m.aircraft_id
        WHERE rg.operation_day_id = ?1
        GROUP BY rg.id, rg.name
        ORDER BY rg.name`,
    )
    .bind(eventId)
    .all<{
      resource_group_id: string;
      resource_group_name: string;
      completed_rotations: number;
      average_boarding_minutes: number | null;
      average_flight_minutes: number | null;
      average_turnaround_minutes: number | null;
      aircraft_types: string | null;
      passenger_seat_counts: string | null;
    }>();
  return {
    status: "READY",
    body: {
      schemaVersion: 1,
      exportedAt,
      context: {
        eventName: event.name,
        eventDate: event.event_date,
        aerodrome: event.aerodrome,
        timeZone: event.time_zone,
      },
      planningDefaults: {
        boardingMinutes: event.planned_boarding_minutes,
        deboardingMinutes: event.planned_deboarding_minutes,
        bufferMinutes: event.planned_buffer_minutes,
      },
      resourceGroups: groups.results.map((group) => ({
        id: group.resource_group_id,
        name: group.resource_group_name,
        completedRotations: group.completed_rotations,
        aircraftTypes: group.aircraft_types?.split(",").sort(order) ?? [],
        passengerSeatCounts:
          group.passenger_seat_counts
            ?.split(",")
            .map(Number)
            .filter(Number.isFinite)
            .sort((left, right) => left - right) ?? [],
        durationsMinutes: {
          boarding: group.average_boarding_minutes,
          flight: group.average_flight_minutes,
          turnaround: group.average_turnaround_minutes,
        },
      })),
    },
  };
}

const ticketExportColumns = [
  "ticket_id",
  "ticket_status",
  "weight_class",
  "payment_method",
  "payment_status",
  "price_cents",
  "created_at",
  "ticket_group_id",
  "queue_sequence",
  "standby",
  "product_id",
  "product_name",
  "resource_group_id",
  "resource_group_name",
  "communication_number",
  "rotation_id",
  "rotation_status",
  "registration",
  "pilot_code",
  "called_at",
  "departed_at",
  "landed_at",
  "completed_at",
] as const;

export async function generateTicketExportCsv(
  database: D1Database,
  eventId: string,
): Promise<string> {
  const rows = await database
    .prepare(
      `SELECT t.id AS ticket_id, t.status AS ticket_status, t.weight_class,
              t.payment_method, t.payment_status, t.price_cents, t.created_at,
              tg.id AS ticket_group_id, tg.queue_sequence, tg.standby,
              p.id AS product_id, p.name AS product_name,
              rg.id AS resource_group_id, rg.name AS resource_group_name,
              fg.communication_number, r.id AS rotation_id, r.status AS rotation_status,
              a.registration, pl.operational_code AS pilot_code,
              r.called_at, r.departed_at, r.landed_at, r.completed_at
         FROM tickets t
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         JOIN products p ON p.id = tg.product_id
         JOIN resource_groups rg ON rg.id = p.resource_group_id
         LEFT JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         LEFT JOIN rotations r ON r.id = rt.rotation_id
         LEFT JOIN flight_groups fg ON fg.id = r.flight_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
         LEFT JOIN pilots pl ON pl.id = r.pilot_id
        WHERE tg.operation_day_id = ?1
        ORDER BY t.created_at, t.id`,
    )
    .bind(eventId)
    .all<Record<string, string | number | null>>();
  return createCsv([
    [...ticketExportColumns],
    ...rows.results.map((row) => ticketExportColumns.map((column) => row[column] ?? null)),
  ]);
}
