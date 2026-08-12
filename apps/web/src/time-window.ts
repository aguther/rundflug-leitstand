export type TimeWindowVariant = "regular" | "compact";
export type TimeWindowPhase = "FORECAST" | "NOW" | "FINISHED";
export type TimeWindowQuality = "STABLE" | "CHANGING" | "UNCERTAIN";

export interface AbsoluteTimeWindowInput {
  lowerAt: string | null;
  upperAt: string | null;
  timeZone: string;
  variant?: TimeWindowVariant;
  phase?: TimeWindowPhase;
  quality?: TimeWindowQuality | null;
  includeClockSuffix?: boolean;
  maximumWidthMinutes?: number;
}

interface LocalDateTime {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
}

function localDateTime(value: string, timeZone: string): LocalDateTime | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const partValue = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: partValue("day"),
    month: partValue("month"),
    year: partValue("year"),
    hour: partValue("hour"),
    minute: partValue("minute"),
  };
}

function sameLocalDate(lower: LocalDateTime, upper: LocalDateTime): boolean {
  return lower.day === upper.day && lower.month === upper.month && lower.year === upper.year;
}

function dateLabel(value: LocalDateTime): string {
  return `${value.day}.${value.month}.${value.year}`;
}

function timeLabel(value: LocalDateTime): string {
  return `${value.hour}:${value.minute}`;
}

function unavailableTimeWindowLabel(variant: TimeWindowVariant): string {
  return variant === "compact" ? "–" : "Wird aktualisiert";
}

function displayTimeWindow(
  window: string,
  variant: TimeWindowVariant,
  includeClockSuffix: boolean | undefined,
): string {
  if (variant === "compact") return window;
  return `ca. ${window}${includeClockSuffix === false ? "" : " Uhr"}`;
}

export function formatAbsoluteTimeWindow(input: AbsoluteTimeWindowInput): string {
  const variant = input.variant ?? "regular";
  if (input.phase === "NOW") return "Jetzt";
  if (input.phase === "FINISHED") return "–";
  if (input.quality === "UNCERTAIN" || input.lowerAt === null || input.upperAt === null) {
    return unavailableTimeWindowLabel(variant);
  }
  if (
    input.maximumWidthMinutes !== undefined &&
    Date.parse(input.upperAt) - Date.parse(input.lowerAt) > input.maximumWidthMinutes * 60_000
  ) {
    return unavailableTimeWindowLabel(variant);
  }

  const lower = localDateTime(input.lowerAt, input.timeZone);
  const upper = localDateTime(input.upperAt, input.timeZone);
  if (!lower || !upper) return unavailableTimeWindowLabel(variant);

  if (sameLocalDate(lower, upper)) {
    const window = `${timeLabel(lower)} – ${timeLabel(upper)}`;
    return displayTimeWindow(window, variant, input.includeClockSuffix);
  }

  const window = `${dateLabel(lower)} ${timeLabel(lower)} – ${dateLabel(upper)} ${timeLabel(upper)}`;
  return displayTimeWindow(window, variant, input.includeClockSuffix);
}
