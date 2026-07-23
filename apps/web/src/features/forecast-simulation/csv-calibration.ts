import type { SimulationConfig, TriangularDistribution } from "./model";

export const MAX_CALIBRATION_FILE_BYTES = 2 * 1_024 * 1_024;

const REDUCED_COLUMNS = [
  "called_at",
  "departed_at",
  "landed_at",
  "completed_at",
  "interrupted",
] as const;

const DAILY_REPORT_COLUMNS = [
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
] as const;

interface CalibrationRow {
  calledAt: number;
  departedAt: number;
  landedAt: number;
  completedAt: number;
}

export interface CalibrationResult {
  format: "REDUCED" | "DAILY_REPORT";
  validRows: number;
  excludedRows: number;
  suggestedPhases: SimulationConfig["realityModel"]["phases"];
}

export class CalibrationCsvError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CalibrationCsvError";
    this.code = code;
  }
}

function delimiterScore(line: string, delimiter: "," | ";"): number {
  let quoted = false;
  let score = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === delimiter) score += 1;
  }
  return score;
}

function detectDelimiter(text: string): "," | ";" {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 25);
  const comma = lines.reduce((sum, line) => sum + delimiterScore(line, ","), 0);
  const semicolon = lines.reduce((sum, line) => sum + delimiterScore(line, ";"), 0);
  if (comma === 0 && semicolon === 0) {
    throw new CalibrationCsvError(
      "DELIMITER_MISSING",
      "Die CSV-Datei enthält keinen erkennbaren Trenner.",
    );
  }
  return semicolon >= comma ? ";" : ",";
}

function parseCsv(text: string, delimiter: "," | ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted)
    throw new CalibrationCsvError(
      "CSV_QUOTES_INVALID",
      "Die CSV-Datei enthält ein offenes Anführungszeichen.",
    );
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

function cleanHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim();
}

function assertAllowedColumns(headers: readonly string[], allowed: readonly string[]): void {
  const invalid = headers.filter((header) => header.length > 0 && !allowed.includes(header));
  if (invalid.length > 0) {
    throw new CalibrationCsvError(
      "COLUMN_NOT_ALLOWED",
      `Nicht unterstützte Spalte: ${invalid.join(", ")}.`,
    );
  }
}

function rowObject(headers: readonly string[], values: readonly string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

function parseTimestamp(value: string): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

function interrupted(value: string): boolean {
  return ["1", "true", "yes", "ja", "x"].includes(value.trim().toLowerCase());
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function robustValues(values: readonly number[]): number[] {
  const plausible = values.filter((value) => Number.isFinite(value) && value > 0 && value <= 720);
  if (plausible.length < 5) return plausible;
  const center = median(plausible);
  const deviation = median(plausible.map((value) => Math.abs(value - center)));
  const tolerance = Math.max(1, deviation * 3);
  return plausible.filter((value) => Math.abs(value - center) <= tolerance);
}

function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  const left = sorted[lower] ?? sorted[0] ?? 0;
  const right = sorted[lower + 1] ?? left;
  return left + fraction * (right - left);
}

function distribution(values: readonly number[]): TriangularDistribution {
  const robust = robustValues(values);
  if (robust.length < 5) {
    throw new CalibrationCsvError(
      "ROBUST_SAMPLE_TOO_SMALL",
      "Nach dem Entfernen unplausibler Messwerte bleiben weniger als fünf Umläufe übrig.",
    );
  }
  const rounded = (value: number) => Math.round(value * 10) / 10;
  return {
    minimum: rounded(quantile(robust, 0.1)),
    typical: rounded(quantile(robust, 0.5)),
    maximum: rounded(quantile(robust, 0.9)),
  };
}

export function calibrateFromCsv(
  input: string,
  currentBuffer: TriangularDistribution,
): CalibrationResult {
  const byteLength = new TextEncoder().encode(input).byteLength;
  if (byteLength > MAX_CALIBRATION_FILE_BYTES) {
    throw new CalibrationCsvError(
      "FILE_TOO_LARGE",
      `Die Datei ist größer als ${MAX_CALIBRATION_FILE_BYTES / 1_024 / 1_024} MiB.`,
    );
  }
  const delimiter = detectDelimiter(input);
  const parsed = parseCsv(input, delimiter);
  const firstContentRow = parsed.findIndex((row) => row.some((cell) => cell.trim().length > 0));
  if (firstContentRow < 0) throw new CalibrationCsvError("CSV_EMPTY", "Die CSV-Datei ist leer.");
  const flightsMarker = parsed.findIndex(
    (row) => row.length === 1 && cleanHeader(row[0] ?? "").toUpperCase() === "FLÜGE",
  );
  const format: CalibrationResult["format"] = flightsMarker >= 0 ? "DAILY_REPORT" : "REDUCED";
  const headerIndex = flightsMarker >= 0 ? flightsMarker + 1 : firstContentRow;
  const headers = (parsed[headerIndex] ?? []).map(cleanHeader);
  if (headers.length === 0) {
    throw new CalibrationCsvError("HEADER_MISSING", "Die CSV-Datei enthält keine Kopfzeile.");
  }

  if (format === "REDUCED") {
    const normalized = headers.map((header) => header.toLowerCase());
    assertAllowedColumns(normalized, REDUCED_COLUMNS);
    for (const required of REDUCED_COLUMNS.slice(0, 4)) {
      if (!normalized.includes(required)) {
        throw new CalibrationCsvError("COLUMN_MISSING", `Pflichtspalte ${required} fehlt.`);
      }
    }
    headers.splice(0, headers.length, ...normalized);
  } else {
    assertAllowedColumns(headers, DAILY_REPORT_COLUMNS);
    for (const required of ["Aufruf", "Start", "Landung", "Abschluss"]) {
      if (!headers.includes(required)) {
        throw new CalibrationCsvError("COLUMN_MISSING", `Pflichtspalte ${required} fehlt.`);
      }
    }
  }

  const rows: CalibrationRow[] = [];
  let excludedRows = 0;
  for (let index = headerIndex + 1; index < parsed.length; index += 1) {
    const values = parsed[index] ?? [];
    if (values.every((value) => value.trim().length === 0)) {
      if (format === "DAILY_REPORT" && rows.length > 0) break;
      continue;
    }
    if (format === "DAILY_REPORT" && values.length === 1 && /^[A-ZÄÖÜ -]+$/.test(values[0] ?? "")) {
      break;
    }
    const record = rowObject(headers, values);
    if (format === "REDUCED" && interrupted(record.interrupted ?? "")) {
      excludedRows += 1;
      continue;
    }
    const calledAt = parseTimestamp(record[format === "REDUCED" ? "called_at" : "Aufruf"] ?? "");
    const departedAt = parseTimestamp(record[format === "REDUCED" ? "departed_at" : "Start"] ?? "");
    const landedAt = parseTimestamp(record[format === "REDUCED" ? "landed_at" : "Landung"] ?? "");
    const completedAt = parseTimestamp(
      record[format === "REDUCED" ? "completed_at" : "Abschluss"] ?? "",
    );
    if (
      ![calledAt, departedAt, landedAt, completedAt].every(Number.isFinite) ||
      calledAt >= departedAt ||
      departedAt >= landedAt ||
      landedAt >= completedAt
    ) {
      excludedRows += 1;
      continue;
    }
    rows.push({ calledAt, departedAt, landedAt, completedAt });
  }
  if (rows.length < 5) {
    throw new CalibrationCsvError(
      "SAMPLE_TOO_SMALL",
      `Mindestens fünf gültige abgeschlossene Umläufe sind erforderlich; gefunden: ${rows.length}.`,
    );
  }
  return {
    format,
    validRows: rows.length,
    excludedRows,
    suggestedPhases: {
      boarding: distribution(rows.map((row) => (row.departedAt - row.calledAt) / 60_000)),
      flight: distribution(rows.map((row) => (row.landedAt - row.departedAt) / 60_000)),
      deboarding: distribution(rows.map((row) => (row.completedAt - row.landedAt) / 60_000)),
      buffer: { ...currentBuffer },
    },
  };
}
