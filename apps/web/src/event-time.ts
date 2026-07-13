const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error(`Die Veranstaltungszeitzone „${timeZone}“ ist ungültig.`);
  }
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function localParts(instant: Date, timeZone: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return parts;
}

function formatParts(parts: Record<string, string>): string {
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatEventLocalDateTime(value: string | null, timeZone: string): string {
  if (!value) return "";
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("Der gespeicherte Zeitpunkt ist ungültig.");
  return formatParts(localParts(instant, timeZone));
}

export function eventDateInTimeZone(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) throw new Error("Der Zeitpunkt ist ungültig.");
  return formatEventLocalDateTime(instant.toISOString(), timeZone).slice(0, 10);
}

function parseLocalDateTime(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Bitte Datum und Uhrzeit vollständig angeben.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const validation = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    validation.getUTCFullYear() !== year ||
    validation.getUTCMonth() !== month - 1 ||
    validation.getUTCDate() !== day ||
    validation.getUTCHours() !== hour ||
    validation.getUTCMinutes() !== minute
  ) {
    throw new Error("Bitte ein gültiges Datum mit Uhrzeit angeben.");
  }
  return { year, month, day, hour, minute };
}

function offsetAt(instantMs: number, timeZone: string): number {
  const instant = new Date(instantMs);
  const parts = localParts(instant, timeZone);
  return (
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    ) - instantMs
  );
}

export function eventLocalDateTimeToIso(value: string, timeZone: string): string {
  const { year, month, day, hour, minute } = parseLocalDateTime(value);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const probeHours = [-168, -48, -24, 0, 24, 48, 168];
  const offsets = new Set(
    probeHours.map((hours) => offsetAt(localAsUtc + hours * 60 * 60 * 1000, timeZone)),
  );
  const candidates = [...offsets]
    .map((offset) => new Date(localAsUtc - offset))
    .filter((candidate) => formatParts(localParts(candidate, timeZone)) === value)
    .map((candidate) => candidate.toISOString());
  const uniqueCandidates = [...new Set(candidates)].sort();

  if (uniqueCandidates.length === 0) {
    throw new Error(
      `Die lokale Zeit ${value.replace("T", " ")} existiert in ${timeZone} wegen der Zeitumstellung nicht.`,
    );
  }
  if (uniqueCandidates.length > 1) {
    throw new Error(
      `Die lokale Zeit ${value.replace("T", " ")} ist in ${timeZone} wegen der Zeitumstellung mehrdeutig. Bitte einen eindeutigen Zeitpunkt wählen.`,
    );
  }
  const candidate = uniqueCandidates[0];
  if (!candidate) throw new Error("Der lokale Zeitpunkt konnte nicht aufgelöst werden.");
  return candidate;
}
