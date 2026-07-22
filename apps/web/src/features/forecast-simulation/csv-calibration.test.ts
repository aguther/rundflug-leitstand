import { describe, expect, it } from "vitest";

import {
  type CalibrationCsvError,
  calibrateFromCsv,
  MAX_CALIBRATION_FILE_BYTES,
} from "./csv-calibration";
import { DEFAULT_PHASES } from "./model";

const rows = Array.from({ length: 6 }, (_, index) => {
  const hour = String(8 + index).padStart(2, "0");
  return `2026-07-22T${hour}:00:00.000Z,2026-07-22T${hour}:07:00.000Z,2026-07-22T${hour}:27:00.000Z,2026-07-22T${hour}:33:00.000Z,false`;
});

describe("forecast CSV calibration", () => {
  it("calibrates the reduced comma-separated format and keeps the buffer manual", () => {
    const csv = ["called_at,departed_at,landed_at,completed_at,interrupted", ...rows].join("\n");
    const result = calibrateFromCsv(csv, DEFAULT_PHASES.buffer);

    expect(result.format).toBe("REDUCED");
    expect(result.validRows).toBe(6);
    expect(result.suggestedPhases.boarding).toEqual({ minimum: 7, typical: 7, maximum: 7 });
    expect(result.suggestedPhases.flight.typical).toBe(20);
    expect(result.suggestedPhases.deboarding.typical).toBe(6);
    expect(result.suggestedPhases.buffer).toEqual(DEFAULT_PHASES.buffer);
  });

  it("reads the FLÜGE section of the semicolon-separated daily report", () => {
    const header =
      "Fluggruppe;Status;Flugzeug;Pilotencode;Passagiere;Kapazität;Auslastung_Prozent;Aufruf;Start;Landung;Abschluss;Boarding_Min;Flug_Min;Boden_Min;Umlauf_Min;Wartezeit_Min";
    const flights = Array.from({ length: 5 }, (_, index) => {
      const hour = String(8 + index).padStart(2, "0");
      return `SIM-${index + 1};COMPLETED;D-SIM;P-01;4;4;100;2026-07-22T${hour}:00:00.000Z;2026-07-22T${hour}:07:00.000Z;2026-07-22T${hour}:27:00.000Z;2026-07-22T${hour}:33:00.000Z;7;20;6;33;10`;
    });
    const csv = ["TAGESBERICHT", "", "FLÜGE", header, ...flights, "", "PROGNOSEENTWICKLUNG"].join(
      "\r\n",
    );
    const result = calibrateFromCsv(csv, DEFAULT_PHASES.buffer);

    expect(result.format).toBe("DAILY_REPORT");
    expect(result.validRows).toBe(5);
  });

  it("excludes interrupted and invalid time sequences before checking sample size", () => {
    const invalid = rows.slice(0, 4);
    invalid.push(
      "2026-07-22T14:00:00.000Z,2026-07-22T14:07:00.000Z,2026-07-22T14:27:00.000Z,2026-07-22T14:33:00.000Z,true",
    );
    invalid.push(
      "2026-07-22T15:00:00.000Z,2026-07-22T14:07:00.000Z,2026-07-22T15:27:00.000Z,2026-07-22T15:33:00.000Z,false",
    );
    const csv = ["called_at,departed_at,landed_at,completed_at,interrupted", ...invalid].join("\n");

    expect(() => calibrateFromCsv(csv, DEFAULT_PHASES.buffer)).toThrowError(
      expect.objectContaining<Partial<CalibrationCsvError>>({ code: "SAMPLE_TOO_SMALL" }),
    );
  });

  it("rejects unsupported columns and files above the local size limit", () => {
    expect(() =>
      calibrateFromCsv(
        ["called_at,departed_at,landed_at,completed_at,guest_name", ...rows].join("\n"),
        DEFAULT_PHASES.buffer,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<CalibrationCsvError>>({ code: "COLUMN_NOT_ALLOWED" }),
    );
    expect(() =>
      calibrateFromCsv("x".repeat(MAX_CALIBRATION_FILE_BYTES + 1), DEFAULT_PHASES.buffer),
    ).toThrowError(
      expect.objectContaining<Partial<CalibrationCsvError>>({ code: "FILE_TOO_LARGE" }),
    );
  });
});
