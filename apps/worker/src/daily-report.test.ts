import { describe, expect, it } from "vitest";
import { type DailyReportData, dailyReportCsv, dailyReportPdfLines } from "./daily-report";

const report: DailyReportData = {
  summary: {
    name: "Synthetischer Flugtag",
    event_date: "2026-07-11",
    tickets: 4,
    cancellations: 1,
    transported_passengers: 3,
    completed_rotations: 1,
    occupied_seats: 3,
    offered_seats: 4,
    average_boarding_minutes: 6,
    average_flight_minutes: 20,
    average_turnaround_minutes: 5,
    average_rotation_minutes: 31,
    average_wait_minutes: 18,
    revenue_cents: 13500,
    forecast_snapshots: 5,
    average_boarding_deviation_minutes: 1.5,
    average_departure_deviation_minutes: 2,
    average_completion_deviation_minutes: 3,
    special_events: 1,
  },
  cashRows: [
    {
      product_name: "Synthetischer Rundflug",
      payment_method: "CASH",
      payment_status: "PAID",
      ticket_count: 4,
      canceled_count: 1,
      amount_cents: 13500,
    },
  ],
  flightRows: [
    {
      communication_label: "SYN-001",
      status: "COMPLETED",
      aircraft_registration: "D-TEST",
      pilot_code: "P-01",
      passenger_count: 3,
      effective_capacity: 4,
      utilization_percent: 75,
      called_at: "2026-07-11T08:00:00.000Z",
      departed_at: "2026-07-11T08:06:00.000Z",
      landed_at: "2026-07-11T08:26:00.000Z",
      completed_at: "2026-07-11T08:31:00.000Z",
      boarding_minutes: 6,
      flight_minutes: 20,
      turnaround_minutes: 5,
      rotation_minutes: 31,
      wait_minutes: 18,
    },
  ],
  forecastRows: [
    {
      communication_label: "SYN-001",
      snapshot_count: 5,
      first_captured_at: "2026-07-11T07:30:00.000Z",
      last_captured_at: "2026-07-11T08:06:00.000Z",
      average_boarding_deviation_minutes: 1.5,
      average_departure_deviation_minutes: 2,
      average_completion_deviation_minutes: 3,
    },
  ],
  specialEventRows: [
    {
      occurred_at: "2026-07-11T07:45:00.000Z",
      event_type: "TICKET_GROUP_DEFERRED",
      aggregate_type: "ROTATION",
      aggregate_id: "rotation-synthetic",
    },
  ],
};

describe("complete daily report", () => {
  it("contains flights, utilization, process times, cash, forecasts and special events", () => {
    const csv = dailyReportCsv(report);

    expect(csv).toContain("Auslastung;75;Prozent");
    expect(csv).toContain("KASSEN-ZÄHLBERICHT");
    expect(csv).toContain("FLÜGE");
    expect(csv).toContain("PROGNOSEENTWICKLUNG");
    expect(csv).toContain("BESONDERE EREIGNISSE");
    expect(csv).toContain("SYN-001;COMPLETED;D-TEST;P-01;3;4;75");
    expect(csv).toContain("TICKET_GROUP_DEFERRED;ROTATION;rotation-synthetic");
    expect(csv).not.toMatch(/guest|phone|telefon/i);
  });

  it("summarizes the same confirmed metrics for the archival PDF", () => {
    const lines = dailyReportPdfLines(report);

    expect(lines.join("\n")).toContain("Auslastung: 75.0 %");
    expect(lines.join("\n")).toContain("Boarding / Flug / Boden: 6 / 20 / 5 Minuten");
    expect(lines.join("\n")).toContain("Prognose-Snapshots: 5");
    expect(lines.join("\n")).toContain("Besondere Ereignisse: 1");
  });
});
