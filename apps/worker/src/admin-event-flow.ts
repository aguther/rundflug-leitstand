import type { AdminEventFlow } from "@rundflug/contracts";

export interface EventFlowTicketRow {
  soldAt: string;
  completedAt: string | null;
}

interface BuildAdminEventFlowInput {
  eventId: string;
  eventDate: string;
  timeZone: string;
  saleOpensAt: string | null;
  operationsEndAt: string | null;
  observedAt: string;
  requestedBucketMinutes?: number;
  tickets: readonly EventFlowTicketRow[];
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
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

function localMidnightIso(eventDate: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  if (!match) throw new Error("Veranstaltungsdatum ist ungültig.");
  const localAsUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0);
  const probes = [-48, -24, 0, 24, 48].map((hours) => {
    const probe = new Date(localAsUtc + hours * 60 * 60 * 1000);
    const parts = localParts(probe, timeZone);
    const renderedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    return renderedAsUtc - probe.getTime();
  });
  for (const offset of new Set(probes)) {
    const candidate = new Date(localAsUtc - offset);
    const parts = localParts(candidate, timeZone);
    if (
      `${parts.year}-${parts.month}-${parts.day}` === eventDate &&
      parts.hour === "00" &&
      parts.minute === "00"
    ) {
      return candidate.toISOString();
    }
  }
  throw new Error("Veranstaltungsbeginn konnte für die Zeitzone nicht bestimmt werden.");
}

function adaptiveBucketMinutes(spanMs: number, requested = 15): number {
  let bucketMinutes = Math.max(5, Math.min(240, Math.round(requested / 5) * 5));
  while (Math.ceil(spanMs / (bucketMinutes * 60_000)) > 95 && bucketMinutes < 24 * 60) {
    bucketMinutes *= 2;
  }
  return bucketMinutes;
}

export function buildAdminEventFlow(input: BuildAdminEventFlowInput): AdminEventFlow {
  const from = input.saleOpensAt ?? localMidnightIso(input.eventDate, input.timeZone);
  const fromMs = Date.parse(from);
  const fallbackUntilMs = fromMs + 12 * 60 * 60 * 1000;
  const configuredUntilMs = input.operationsEndAt
    ? Date.parse(input.operationsEndAt)
    : fallbackUntilMs;
  const plannedUntilMs =
    Number.isFinite(configuredUntilMs) && configuredUntilMs > fromMs
      ? configuredUntilMs
      : fallbackUntilMs;
  const observedAtMs = Date.parse(input.observedAt);
  const observedUntilMs = Math.max(
    fromMs,
    Math.min(Number.isFinite(observedAtMs) ? observedAtMs : fromMs, plannedUntilMs),
  );
  const bucketMinutes = adaptiveBucketMinutes(
    Math.max(0, observedUntilMs - fromMs),
    input.requestedBucketMinutes,
  );
  const bucketMs = bucketMinutes * 60_000;
  const boundaries: number[] = [fromMs];
  for (let at = fromMs + bucketMs; at < observedUntilMs; at += bucketMs) boundaries.push(at);
  if (boundaries.at(-1) !== observedUntilMs) boundaries.push(observedUntilMs);

  const tickets = input.tickets
    .map((ticket) => ({
      soldAtMs: Date.parse(ticket.soldAt),
      completedAtMs: ticket.completedAt ? Date.parse(ticket.completedAt) : null,
    }))
    .filter((ticket) => Number.isFinite(ticket.soldAtMs));

  return {
    eventId: input.eventId,
    from: new Date(fromMs).toISOString(),
    plannedUntil: new Date(plannedUntilMs).toISOString(),
    observedUntil: new Date(observedUntilMs).toISOString(),
    bucketMinutes,
    points: boundaries.map((boundary) => {
      let soldTickets = 0;
      let completedTickets = 0;
      for (const ticket of tickets) {
        if (ticket.soldAtMs > boundary) continue;
        soldTickets += 1;
        if (ticket.completedAtMs !== null && ticket.completedAtMs <= boundary) {
          completedTickets += 1;
        }
      }
      return {
        at: new Date(boundary).toISOString(),
        soldTickets,
        completedTickets,
        openTickets: Math.max(0, soldTickets - completedTickets),
      };
    }),
  };
}
