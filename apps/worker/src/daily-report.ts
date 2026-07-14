import { createCsv } from "./report";

type SummaryRow = {
  name: string;
  event_date: string;
  tickets: number;
  cancellations: number;
  transported_passengers: number;
  completed_rotations: number;
  occupied_seats: number;
  offered_seats: number;
  average_boarding_minutes: number | null;
  average_flight_minutes: number | null;
  average_turnaround_minutes: number | null;
  average_rotation_minutes: number | null;
  average_wait_minutes: number | null;
  revenue_cents: number;
  forecast_snapshots: number;
  average_boarding_deviation_minutes: number | null;
  average_departure_deviation_minutes: number | null;
  average_completion_deviation_minutes: number | null;
  special_events: number;
};

type CashRow = {
  product_name: string;
  payment_method: string | null;
  payment_status: string;
  ticket_count: number;
  canceled_count: number;
  amount_cents: number;
};

type FlightRow = {
  communication_label: string;
  status: string;
  aircraft_registration: string | null;
  pilot_code: string | null;
  passenger_count: number;
  effective_capacity: number;
  utilization_percent: number | null;
  called_at: string | null;
  departed_at: string | null;
  landed_at: string | null;
  completed_at: string | null;
  boarding_minutes: number | null;
  flight_minutes: number | null;
  turnaround_minutes: number | null;
  rotation_minutes: number | null;
  wait_minutes: number | null;
};

type ForecastRow = {
  communication_label: string;
  snapshot_count: number;
  first_captured_at: string;
  last_captured_at: string;
  average_boarding_deviation_minutes: number | null;
  average_departure_deviation_minutes: number | null;
  average_completion_deviation_minutes: number | null;
};

type SpecialEventRow = {
  occurred_at: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
};

export type DailyReportData = {
  summary: SummaryRow;
  cashRows: CashRow[];
  flightRows: FlightRow[];
  forecastRows: ForecastRow[];
  specialEventRows: SpecialEventRow[];
};

const specialEventTypes = [
  "EMERGENCY_MODE_TRIGGERED",
  "EMERGENCY_MODE_CLEARED",
  "EVENT_OPERATION_INTERRUPTED",
  "EVENT_OPERATION_RESUMED",
  "RESOURCE_GROUP_STATUS_CHANGED",
  "AIRCRAFT_OPERATIONAL_STATE_CHANGED",
  "PILOT_PAUSE_STARTED",
  "PILOT_PAUSE_ENDED",
  "ROTATION_ABORTED_TO_QUEUE",
  "CALL_REVOKED",
  "TICKET_GROUP_NO_SHOW",
  "TICKET_GROUP_DEFERRED",
  "TICKET_GROUP_CANCELED",
  "TICKET_GROUP_REBOOKED",
  "TICKET_GROUP_MOVED",
  "ROTATION_CAPACITY_CHANGED",
  "OUTAGE_RECOVERY_APPLIED",
];
const specialEventSql = specialEventTypes.map((value) => `'${value}'`).join(", ");

export async function loadDailyReport(
  db: D1Database,
  eventId: string,
): Promise<DailyReportData | null> {
  const [summary, cash, flights, forecasts, specialEvents] = await Promise.all([
    db
      .prepare(
        `SELECT od.name, od.event_date,
                (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
                  WHERE tg.operation_day_id = od.id) AS tickets,
                (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
                  WHERE tg.operation_day_id = od.id AND t.status = 'CANCELED') AS cancellations,
                (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
                  WHERE tg.operation_day_id = od.id AND t.status = 'COMPLETED') AS transported_passengers,
                (SELECT COUNT(*) FROM rotations r
                  WHERE r.operation_day_id = od.id AND r.status = 'COMPLETED') AS completed_rotations,
                (SELECT COUNT(*) FROM rotation_tickets rt JOIN rotations r ON r.id = rt.rotation_id
                  WHERE r.operation_day_id = od.id AND r.status = 'COMPLETED'
                    AND rt.released_at IS NULL) AS occupied_seats,
                (SELECT COALESCE(SUM(COALESCE(r.usable_capacity, a.passenger_seats)), 0)
                   FROM rotations r LEFT JOIN aircraft a ON a.id = r.aircraft_id
                  WHERE r.operation_day_id = od.id AND r.status = 'COMPLETED') AS offered_seats,
                (SELECT ROUND(AVG((julianday(r.departed_at) - julianday(r.called_at)) * 1440.0), 1)
                   FROM rotations r WHERE r.operation_day_id = od.id
                    AND r.called_at IS NOT NULL AND r.departed_at IS NOT NULL) AS average_boarding_minutes,
                (SELECT ROUND(AVG((julianday(r.landed_at) - julianday(r.departed_at)) * 1440.0), 1)
                   FROM rotations r WHERE r.operation_day_id = od.id
                    AND r.departed_at IS NOT NULL AND r.landed_at IS NOT NULL) AS average_flight_minutes,
                (SELECT ROUND(AVG((julianday(r.completed_at) - julianday(r.landed_at)) * 1440.0), 1)
                   FROM rotations r WHERE r.operation_day_id = od.id
                    AND r.landed_at IS NOT NULL AND r.completed_at IS NOT NULL) AS average_turnaround_minutes,
                (SELECT ROUND(AVG((julianday(r.completed_at) - julianday(r.called_at)) * 1440.0), 1)
                   FROM rotations r WHERE r.operation_day_id = od.id
                    AND r.called_at IS NOT NULL AND r.completed_at IS NOT NULL) AS average_rotation_minutes,
                (SELECT ROUND(AVG((julianday(r.called_at) - julianday(tg.sold_at)) * 1440.0), 1)
                   FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
                   JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
                   JOIN rotations r ON r.id = rt.rotation_id
                  WHERE tg.operation_day_id = od.id AND r.called_at IS NOT NULL) AS average_wait_minutes,
                (SELECT COALESCE(SUM(CASE WHEN t.status <> 'CANCELED' THEN t.price_cents ELSE 0 END), 0)
                   FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
                  WHERE tg.operation_day_id = od.id) AS revenue_cents,
                (SELECT COUNT(*) FROM forecast_snapshots fs
                  WHERE fs.operation_day_id = od.id) AS forecast_snapshots,
                (SELECT ROUND(AVG(ABS((julianday(r.called_at) - julianday(fs.predicted_boarding_at)) * 1440.0)), 1)
                   FROM forecast_snapshots fs JOIN rotations r ON r.id = fs.rotation_id
                  WHERE fs.operation_day_id = od.id AND r.called_at IS NOT NULL
                    AND fs.predicted_boarding_at IS NOT NULL) AS average_boarding_deviation_minutes,
                (SELECT ROUND(AVG(ABS((julianday(r.departed_at) - julianday(fs.predicted_departure_at)) * 1440.0)), 1)
                   FROM forecast_snapshots fs JOIN rotations r ON r.id = fs.rotation_id
                  WHERE fs.operation_day_id = od.id AND r.departed_at IS NOT NULL
                    AND fs.predicted_departure_at IS NOT NULL) AS average_departure_deviation_minutes,
                (SELECT ROUND(AVG(ABS((julianday(r.completed_at) - julianday(fs.predicted_completion_at)) * 1440.0)), 1)
                   FROM forecast_snapshots fs JOIN rotations r ON r.id = fs.rotation_id
                  WHERE fs.operation_day_id = od.id AND r.completed_at IS NOT NULL
                    AND fs.predicted_completion_at IS NOT NULL) AS average_completion_deviation_minutes,
                (SELECT COUNT(*) FROM operational_events oe WHERE oe.operation_day_id = od.id
                  AND oe.event_type IN (${specialEventSql})) AS special_events
           FROM operation_days od WHERE od.id = ?1`,
      )
      .bind(eventId)
      .first<SummaryRow>(),
    db
      .prepare(
        `SELECT p.name AS product_name, t.payment_method, t.payment_status,
                COUNT(*) AS ticket_count,
                SUM(CASE WHEN t.status = 'CANCELED' THEN 1 ELSE 0 END) AS canceled_count,
                SUM(CASE WHEN t.status <> 'CANCELED' THEN t.price_cents ELSE 0 END) AS amount_cents
           FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
           JOIN products p ON p.id = tg.product_id
          WHERE tg.operation_day_id = ?1
          GROUP BY p.id, t.payment_method, t.payment_status
          ORDER BY p.name, t.payment_method`,
      )
      .bind(eventId)
      .all<CashRow>(),
    db
      .prepare(
        `SELECT COALESCE((SELECT MIN(p.code) FROM rotation_tickets label_rt
                          JOIN tickets label_t ON label_t.id = label_rt.ticket_id
                          JOIN ticket_groups label_tg ON label_tg.id = label_t.ticket_group_id
                          JOIN products p ON p.id = label_tg.product_id
                         WHERE label_rt.rotation_id = r.id), 'FG') || '-' ||
                       printf('%03d', fg.communication_number) AS communication_label,
                r.status, a.registration AS aircraft_registration,
                pl.operational_code AS pilot_code,
                COUNT(CASE WHEN rt.ticket_id IS NOT NULL AND rt.released_at IS NULL THEN 1 END) AS passenger_count,
                COALESCE(r.usable_capacity, a.passenger_seats, 0) AS effective_capacity,
                CASE WHEN COALESCE(r.usable_capacity, a.passenger_seats, 0) = 0 THEN NULL
                  ELSE ROUND(COUNT(CASE WHEN rt.ticket_id IS NOT NULL AND rt.released_at IS NULL THEN 1 END) * 100.0 /
                    COALESCE(r.usable_capacity, a.passenger_seats), 1) END AS utilization_percent,
                r.called_at, r.departed_at, r.landed_at, r.completed_at,
                CASE WHEN r.called_at IS NULL OR r.departed_at IS NULL THEN NULL
                  ELSE ROUND((julianday(r.departed_at) - julianday(r.called_at)) * 1440.0, 1) END AS boarding_minutes,
                CASE WHEN r.departed_at IS NULL OR r.landed_at IS NULL THEN NULL
                  ELSE ROUND((julianday(r.landed_at) - julianday(r.departed_at)) * 1440.0, 1) END AS flight_minutes,
                CASE WHEN r.landed_at IS NULL OR r.completed_at IS NULL THEN NULL
                  ELSE ROUND((julianday(r.completed_at) - julianday(r.landed_at)) * 1440.0, 1) END AS turnaround_minutes,
                CASE WHEN r.called_at IS NULL OR r.completed_at IS NULL THEN NULL
                  ELSE ROUND((julianday(r.completed_at) - julianday(r.called_at)) * 1440.0, 1) END AS rotation_minutes,
                ROUND(AVG(CASE WHEN r.called_at IS NULL THEN NULL
                  ELSE (julianday(r.called_at) - julianday(tg.sold_at)) * 1440.0 END), 1) AS wait_minutes
           FROM rotations r JOIN flight_groups fg ON fg.id = r.flight_group_id
           LEFT JOIN aircraft a ON a.id = r.aircraft_id
           LEFT JOIN pilots pl ON pl.id = r.pilot_id
           LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id
           LEFT JOIN tickets t ON t.id = rt.ticket_id
           LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
          WHERE r.operation_day_id = ?1
          GROUP BY r.id ORDER BY COALESCE(r.called_at, r.created_at), r.id`,
      )
      .bind(eventId)
      .all<FlightRow>(),
    db
      .prepare(
        `SELECT COALESCE((SELECT MIN(p.code) FROM rotation_tickets label_rt
                          JOIN tickets label_t ON label_t.id = label_rt.ticket_id
                          JOIN ticket_groups label_tg ON label_tg.id = label_t.ticket_group_id
                          JOIN products p ON p.id = label_tg.product_id
                         WHERE label_rt.rotation_id = r.id), 'FG') || '-' ||
                       printf('%03d', fg.communication_number) AS communication_label,
                COUNT(*) AS snapshot_count, MIN(fs.captured_at) AS first_captured_at,
                MAX(fs.captured_at) AS last_captured_at,
                ROUND(AVG(ABS((julianday(r.called_at) - julianday(fs.predicted_boarding_at)) * 1440.0)), 1)
                  AS average_boarding_deviation_minutes,
                ROUND(AVG(ABS((julianday(r.departed_at) - julianday(fs.predicted_departure_at)) * 1440.0)), 1)
                  AS average_departure_deviation_minutes,
                ROUND(AVG(ABS((julianday(r.completed_at) - julianday(fs.predicted_completion_at)) * 1440.0)), 1)
                  AS average_completion_deviation_minutes
           FROM forecast_snapshots fs JOIN rotations r ON r.id = fs.rotation_id
           JOIN flight_groups fg ON fg.id = r.flight_group_id
          WHERE fs.operation_day_id = ?1 GROUP BY fs.rotation_id
          ORDER BY MIN(fs.captured_at), fs.rotation_id`,
      )
      .bind(eventId)
      .all<ForecastRow>(),
    db
      .prepare(
        `SELECT occurred_at, event_type, aggregate_type, aggregate_id
           FROM operational_events WHERE operation_day_id = ?1
            AND event_type IN (${specialEventSql})
          ORDER BY sequence`,
      )
      .bind(eventId)
      .all<SpecialEventRow>(),
  ]);

  if (!summary) return null;
  return {
    summary,
    cashRows: cash.results,
    flightRows: flights.results,
    forecastRows: forecasts.results,
    specialEventRows: specialEvents.results,
  };
}

const value = (entry: number | null) => entry ?? "";
export function dailyReportCsv(data: DailyReportData): string {
  const { summary } = data;
  const utilization =
    summary.offered_seats > 0
      ? Math.round((summary.occupied_seats * 1000) / summary.offered_seats) / 10
      : null;
  return createCsv([
    ["TAGESBERICHT", summary.name, summary.event_date],
    [],
    ["KENNZAHL", "WERT", "EINHEIT"],
    ["Tickets gesamt", summary.tickets, "Tickets"],
    ["Stornos", summary.cancellations, "Tickets"],
    ["Beförderte Passagiere", summary.transported_passengers, "Personen"],
    ["Abgeschlossene Umläufe", summary.completed_rotations, "Umläufe"],
    ["Auslastung", value(utilization), "Prozent"],
    ["Mittlere Boardingdauer", value(summary.average_boarding_minutes), "Minuten"],
    ["Mittlere Flugzeit", value(summary.average_flight_minutes), "Minuten"],
    ["Mittlere Bodenzeit", value(summary.average_turnaround_minutes), "Minuten"],
    ["Mittlere Umlaufzeit", value(summary.average_rotation_minutes), "Minuten"],
    ["Mittlere Wartezeit", value(summary.average_wait_minutes), "Minuten"],
    ["Informatorischer Umsatz", summary.revenue_cents, "Cent"],
    ["Prognose-Snapshots", summary.forecast_snapshots, "Snapshots"],
    [
      "Mittlere Boarding-Prognoseabweichung",
      value(summary.average_boarding_deviation_minutes),
      "Minuten absolut",
    ],
    [
      "Mittlere Start-Prognoseabweichung",
      value(summary.average_departure_deviation_minutes),
      "Minuten absolut",
    ],
    [
      "Mittlere Abschluss-Prognoseabweichung",
      value(summary.average_completion_deviation_minutes),
      "Minuten absolut",
    ],
    ["Besondere Ereignisse", summary.special_events, "Ereignisse"],
    [],
    ["KASSEN-ZÄHLBERICHT"],
    ["Produkt", "Zahlart", "Zahlstatus", "Tickets", "Stornos", "Betrag_Cent"],
    ...data.cashRows.map((row) => [
      row.product_name,
      row.payment_method ?? "NICHT_ERFASST",
      row.payment_status,
      row.ticket_count,
      row.canceled_count,
      row.amount_cents,
    ]),
    [],
    ["FLÜGE"],
    [
      "Fluggruppe",
      "Status",
      "Flugzeug",
      "Pilotencode",
      "Passagiere",
      "Kapazität",
      "Auslastung_Prozent",
      "Aufruf",
      "Start",
      "Landung",
      "Abschluss",
      "Boarding_Min",
      "Flug_Min",
      "Boden_Min",
      "Umlauf_Min",
      "Wartezeit_Min",
    ],
    ...data.flightRows.map((row) => [
      row.communication_label,
      row.status,
      row.aircraft_registration,
      row.pilot_code,
      row.passenger_count,
      row.effective_capacity,
      value(row.utilization_percent),
      row.called_at,
      row.departed_at,
      row.landed_at,
      row.completed_at,
      value(row.boarding_minutes),
      value(row.flight_minutes),
      value(row.turnaround_minutes),
      value(row.rotation_minutes),
      value(row.wait_minutes),
    ]),
    [],
    ["PROGNOSEENTWICKLUNG"],
    [
      "Fluggruppe",
      "Snapshots",
      "Erste Prognose",
      "Letzte Prognose",
      "Boarding-Abweichung_Min",
      "Start-Abweichung_Min",
      "Abschluss-Abweichung_Min",
    ],
    ...data.forecastRows.map((row) => [
      row.communication_label,
      row.snapshot_count,
      row.first_captured_at,
      row.last_captured_at,
      value(row.average_boarding_deviation_minutes),
      value(row.average_departure_deviation_minutes),
      value(row.average_completion_deviation_minutes),
    ]),
    [],
    ["BESONDERE EREIGNISSE"],
    ["Zeitpunkt", "Ereignistyp", "Bezugsart", "Bezugs-ID"],
    ...data.specialEventRows.map((row) => [
      row.occurred_at,
      row.event_type,
      row.aggregate_type,
      row.aggregate_id,
    ]),
  ]);
}

export function dailyReportPdfLines(data: DailyReportData): string[] {
  const { summary } = data;
  const utilization =
    summary.offered_seats > 0
      ? `${((summary.occupied_seats * 100) / summary.offered_seats).toFixed(1)} %`
      : "-";
  const metric = (entry: number | null) => (entry === null ? "-" : String(entry));
  return [
    `Datum: ${summary.event_date}`,
    `Tickets / Stornos: ${summary.tickets} / ${summary.cancellations}`,
    `Befoerderte Passagiere: ${summary.transported_passengers}`,
    `Abgeschlossene Umlaeufe: ${summary.completed_rotations}`,
    `Auslastung: ${utilization}`,
    `Boarding / Flug / Boden: ${metric(summary.average_boarding_minutes)} / ${metric(summary.average_flight_minutes)} / ${metric(summary.average_turnaround_minutes)} Minuten`,
    `Mittlere Umlaufzeit: ${metric(summary.average_rotation_minutes)} Minuten`,
    `Mittlere Wartezeit: ${metric(summary.average_wait_minutes)} Minuten`,
    `Informatorischer Umsatz: ${(summary.revenue_cents / 100).toFixed(2)} EUR`,
    `Prognose-Snapshots: ${summary.forecast_snapshots}`,
    `Mittlere Prognoseabweichung Boarding / Start / Abschluss: ${metric(summary.average_boarding_deviation_minutes)} / ${metric(summary.average_departure_deviation_minutes)} / ${metric(summary.average_completion_deviation_minutes)} Minuten`,
    `Besondere Ereignisse: ${summary.special_events}`,
    "Zeitangaben basieren auf bestaetigten operativen Ist-Ereignissen.",
    "Betragsangaben sind rein informatorisch.",
  ];
}
