import {
  type AuditHistory,
  auditHistorySchema,
  type BootstrapRequest,
  type CloneEventRequest,
  type CommandEnvelope,
  type CommandResult,
  commandResultSchema,
  type EventCatalog,
  type EventSnapshot,
  eventCatalogSchema,
  eventSnapshotSchema,
  type FactoryResetRequest,
  type FactoryResetResponse,
  type ForecastHistory,
  type ForecastHistoryQuery,
  factoryResetResponseSchema,
  forecastHistorySchema,
  type OperationalHistory,
  type OperationalHistoryQuery,
  type OperationBoard,
  operationalHistorySchema,
  operationBoardSchema,
  type PublicBoard,
  type PublicTicketStatus,
  publicBoardSchema,
  publicTicketStatusSchema,
  type TicketGroupPrintData,
  type TicketSearchResponse,
  ticketGroupPrintDataSchema,
  ticketSearchResponseSchema,
} from "@rundflug/contracts";

const SERVER_UNREACHABLE_MESSAGE =
  "Server nicht erreichbar. Bitte Verbindung prüfen und die Seite neu laden.";
const LEGACY_DEVELOPMENT_DEVICE_AUTH = import.meta.env.MODE === "development";

function apiGetUrl(input: RequestInfo | URL, init?: RequestInit): string | null {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET") return null;
  const value =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (value.startsWith("/api/")) return value;
  if (typeof window === "undefined") return null;
  const url = new URL(value, window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith("/api/")
    ? url.toString()
    : null;
}

function xhrApiGet(url: string, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.withCredentials = true;
    for (const [name, value] of new Headers(init?.headers)) request.setRequestHeader(name, value);
    const abort = () => request.abort();
    init?.signal?.addEventListener("abort", abort, { once: true });
    request.addEventListener("load", () => {
      init?.signal?.removeEventListener("abort", abort);
      const contentType = request.getResponseHeader("content-type");
      resolve(
        new Response(request.responseText, {
          status: request.status,
          statusText: request.statusText,
          ...(contentType ? { headers: { "content-type": contentType } } : {}),
        }),
      );
    });
    request.addEventListener("error", () => {
      init?.signal?.removeEventListener("abort", abort);
      reject(new TypeError("XMLHttpRequest failed"));
    });
    request.addEventListener("abort", () => {
      init?.signal?.removeEventListener("abort", abort);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
    request.send();
  });
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    const fallbackUrl = apiGetUrl(input, init);
    if (fallbackUrl && typeof XMLHttpRequest !== "undefined") {
      try {
        return await xhrApiGet(fallbackUrl, init);
      } catch (fallbackCause) {
        if (fallbackCause instanceof DOMException && fallbackCause.name === "AbortError") {
          throw fallbackCause;
        }
        throw new Error(SERVER_UNREACHABLE_MESSAGE, { cause: fallbackCause });
      }
    }
    throw new Error(SERVER_UNREACHABLE_MESSAGE, { cause });
  }
}

function deviceHeaders(
  deviceId: string,
  deviceToken: string,
  additional: Record<string, string> = {},
): Record<string, string> {
  // A device ID without its credential is not authentication. Session-authenticated browsers stay
  // on the plain same-origin request path; the Worker derives their device identity from the
  // HttpOnly session. This also avoids WebKit's fragile custom-header PWA transport path.
  return {
    ...additional,
    ...(LEGACY_DEVELOPMENT_DEVICE_AUTH && deviceToken
      ? { "x-device-id": deviceId, "x-device-token": deviceToken }
      : {}),
  };
}

export async function getSetupStatus(): Promise<{
  setupRequired: boolean;
  setupConfigured: boolean;
}> {
  const response = await apiFetch("/api/setup/status", {
    headers: { "cache-control": "no-store" },
  });
  if (!response.ok) throw new Error("Einrichtungsstatus ist nicht verfügbar.");
  return response.json();
}

export async function bootstrapSystem(input: BootstrapRequest): Promise<{ eventId: string }> {
  const response = await apiFetch("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as {
    eventId?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.eventId) {
    throw new Error(body.error?.message ?? "Ersteinrichtung fehlgeschlagen.");
  }
  return { eventId: body.eventId };
}

export async function verifyAdminPin(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  adminPin: string,
): Promise<void> {
  const response = await apiFetch(`/api/admin/events/${encodeURIComponent(eventId)}/verify-pin`, {
    method: "POST",
    headers: deviceHeaders(deviceId, deviceToken, { "content-type": "application/json" }),
    body: JSON.stringify({ adminPin }),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? "Administrator-PIN konnte nicht geprüft werden.");
  }
}

export async function claimFlightLineAircraft(
  eventId: string,
  aircraftId: string,
  deviceId: string,
  deviceToken: string,
): Promise<{
  aircraftId: string;
  claimedByCurrentSession: true;
  claimedAt: string;
  expiresAt: string;
}> {
  const response = await apiFetch(
    `/api/events/${encodeURIComponent(eventId)}/assist-claims/${encodeURIComponent(aircraftId)}`,
    {
      method: "PUT",
      headers: deviceHeaders(deviceId, deviceToken),
    },
  );
  const body = (await response.json()) as {
    aircraftId?: string;
    claimedByCurrentSession?: boolean;
    claimedAt?: string;
    expiresAt?: string;
    error?: { message?: string };
  };
  if (
    !response.ok ||
    !body.aircraftId ||
    body.claimedByCurrentSession !== true ||
    !body.claimedAt ||
    !body.expiresAt
  ) {
    throw new Error(body.error?.message ?? "Betreuung konnte nicht übernommen werden.");
  }
  return body as {
    aircraftId: string;
    claimedByCurrentSession: true;
    claimedAt: string;
    expiresAt: string;
  };
}

export async function releaseFlightLineAircraft(
  eventId: string,
  aircraftId: string,
  deviceId: string,
  deviceToken: string,
): Promise<void> {
  const response = await apiFetch(
    `/api/events/${encodeURIComponent(eventId)}/assist-claims/${encodeURIComponent(aircraftId)}`,
    {
      method: "DELETE",
      headers: deviceHeaders(deviceId, deviceToken),
    },
  );
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? "Betreuung konnte nicht beendet werden.");
  }
}

export async function searchTickets(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  query: string,
): Promise<TicketSearchResponse> {
  const response = await apiFetch(
    `/api/events/${encodeURIComponent(eventId)}/tickets/search?q=${encodeURIComponent(query)}`,
    { headers: deviceHeaders(deviceId, deviceToken) },
  );
  if (!response.ok) throw new Error("Ticketsuche nicht verfügbar.");
  return ticketSearchResponseSchema.parse(await response.json());
}

export async function getTicketGroupPrintData(
  eventId: string,
  ticketGroupId: string,
  deviceId: string,
  deviceToken: string,
): Promise<TicketGroupPrintData> {
  const response = await apiFetch(
    `/api/events/${encodeURIComponent(eventId)}/ticket-groups/${encodeURIComponent(ticketGroupId)}/print-data`,
    { headers: deviceHeaders(deviceId, deviceToken) },
  );
  if (!response.ok) throw new Error("Ticketzettel konnten nicht geladen werden.");
  return ticketGroupPrintDataSchema.parse(await response.json());
}

export async function getEventCatalog(
  sourceEventId: string,
  deviceId: string,
  deviceToken: string,
): Promise<EventCatalog> {
  const response = await apiFetch("/api/admin/events", {
    headers: deviceHeaders(deviceId, deviceToken, { "x-event-id": sourceEventId }),
  });
  if (!response.ok) throw new Error("Veranstaltungsliste nicht verfügbar.");
  return eventCatalogSchema.parse(await response.json());
}

export async function cloneEvent(
  sourceEventId: string,
  deviceId: string,
  deviceToken: string,
  input: CloneEventRequest,
): Promise<{ eventId: string; templateSourceId: string }> {
  const response = await apiFetch(`/api/admin/events/${encodeURIComponent(sourceEventId)}/clone`, {
    method: "POST",
    headers: deviceHeaders(deviceId, deviceToken, { "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as {
    eventId?: string;
    templateSourceId?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.eventId || !body.templateSourceId) {
    throw new Error(body.error?.message ?? "Veranstaltung konnte nicht angelegt werden.");
  }
  return body as { eventId: string; templateSourceId: string };
}

export async function deleteEvent(
  sourceEventId: string,
  eventId: string,
  deviceId: string,
  deviceToken: string,
  reason: string,
): Promise<{ deleted: true; eventId: string; setupRequired: boolean }> {
  const response = await apiFetch(`/api/admin/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: deviceHeaders(deviceId, deviceToken, {
      "content-type": "application/json",
      "x-event-id": sourceEventId,
    }),
    body: JSON.stringify({ confirmation: eventId, reason }),
  });
  const body = (await response.json()) as {
    deleted?: boolean;
    eventId?: string;
    setupRequired?: boolean;
    error?: { message?: string };
  };
  if (!response.ok || body.deleted !== true || body.eventId !== eventId) {
    throw new Error(body.error?.message ?? "Veranstaltung konnte nicht gelöscht werden.");
  }
  return body as { deleted: true; eventId: string; setupRequired: boolean };
}

export async function uploadEventLogo(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  expectedVersion: number,
  file: File,
): Promise<{ logoUrl: string }> {
  const response = await apiFetch(`/api/admin/events/${encodeURIComponent(eventId)}/logo`, {
    method: "PUT",
    headers: deviceHeaders(deviceId, deviceToken, {
      "content-type": file.type,
      "x-command-id": crypto.randomUUID(),
      "x-expected-version": String(expectedVersion),
    }),
    body: file,
  });
  const body = (await response.json()) as { logoUrl?: string; error?: { message?: string } };
  if (!response.ok || !body.logoUrl) {
    throw new Error(body.error?.message ?? "Veranstaltungslogo konnte nicht gespeichert werden.");
  }
  return { logoUrl: body.logoUrl };
}

export async function removeEventLogo(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  expectedVersion: number,
): Promise<void> {
  const response = await apiFetch(`/api/admin/events/${encodeURIComponent(eventId)}/logo`, {
    method: "DELETE",
    headers: deviceHeaders(deviceId, deviceToken, {
      "x-command-id": crypto.randomUUID(),
      "x-expected-version": String(expectedVersion),
    }),
  });
  if (!response.ok) throw new Error("Veranstaltungslogo konnte nicht entfernt werden.");
}

export async function factoryReset(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  input: FactoryResetRequest,
): Promise<FactoryResetResponse> {
  const response = await apiFetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/factory-reset`,
    {
      method: "POST",
      headers: deviceHeaders(deviceId, deviceToken, { "content-type": "application/json" }),
      body: JSON.stringify(input),
    },
  );
  const body = (await response.json()) as unknown;
  const completed = factoryResetResponseSchema.safeParse(body);
  if (completed.success) return completed.data;
  const error = body as { error?: { message?: string } };
  throw new Error(error.error?.message ?? "Werkszustand konnte nicht hergestellt werden.");
}

export async function getAuditHistory(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  filters: {
    eventType?: string;
    aggregateType?: string;
    aggregateId?: string;
    since?: string;
    until?: string;
  } = {},
): Promise<AuditHistory> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const response = await apiFetch(
    `/api/events/${encodeURIComponent(eventId)}/history?${query.toString()}`,
    {
      headers: deviceHeaders(deviceId, deviceToken),
    },
  );
  if (!response.ok) throw new Error("Audit-Historie nicht verfügbar.");
  return auditHistorySchema.parse(await response.json());
}

function historyQuery(filters: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return query.toString();
}

export async function getOperationalHistory(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  filters: Partial<OperationalHistoryQuery> = {},
): Promise<OperationalHistory> {
  const response = await apiFetch(
    `/api/events/${encodeURIComponent(eventId)}/history/operations?${historyQuery(filters)}`,
    { headers: deviceHeaders(deviceId, deviceToken) },
  );
  if (!response.ok) throw new Error("Betriebshistorie nicht verfügbar.");
  return operationalHistorySchema.parse(await response.json());
}

export async function getForecastHistory(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  filters: Partial<ForecastHistoryQuery> = {},
): Promise<ForecastHistory> {
  const response = await apiFetch(
    `/api/events/${encodeURIComponent(eventId)}/history/forecasts?${historyQuery(filters)}`,
    { headers: deviceHeaders(deviceId, deviceToken) },
  );
  if (!response.ok) throw new Error("Prognosehistorie nicht verfügbar.");
  return forecastHistorySchema.parse(await response.json());
}

export async function downloadDailyReport(
  eventId: string,
  deviceId: string,
  deviceToken: string,
): Promise<void> {
  const response = await apiFetch(`/api/events/${encodeURIComponent(eventId)}/reports/daily.csv`, {
    headers: deviceHeaders(deviceId, deviceToken),
  });
  if (!response.ok) throw new Error("Tagesbericht nicht verfügbar.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tagesbericht-${eventId}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadProtectedFile(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  path: string,
  filename: string,
): Promise<void> {
  const response = await apiFetch(`/api/events/${encodeURIComponent(eventId)}/${path}`, {
    headers: deviceHeaders(deviceId, deviceToken),
  });
  if (!response.ok) throw new Error("Export nicht verfügbar.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const downloadDailyPdf = (eventId: string, deviceId: string, deviceToken: string) =>
  downloadProtectedFile(
    eventId,
    deviceId,
    deviceToken,
    "reports/daily.pdf",
    `tagesbericht-${eventId}.pdf`,
  );

export const downloadTicketRawData = (eventId: string, deviceId: string, deviceToken: string) =>
  downloadProtectedFile(
    eventId,
    deviceId,
    deviceToken,
    "exports/tickets.csv",
    `rohdaten-tickets-${eventId}.csv`,
  );

export const downloadPerformanceProfile = (
  eventId: string,
  deviceId: string,
  deviceToken: string,
) =>
  downloadProtectedFile(
    eventId,
    deviceId,
    deviceToken,
    "exports/performance-profile.json",
    `leistungsprofil-${eventId}.json`,
  );

export interface HealthResponse {
  ok: boolean;
  service: string;
  environment: string;
  requirementsVersion: string;
  timestamp: string;
}

export async function getPublicBoard(
  eventId: string,
  gateId?: string | null,
  signal?: AbortSignal,
): Promise<PublicBoard> {
  const query = gateId ? `?gateId=${encodeURIComponent(gateId)}` : "";
  const response = await apiFetch(
    `/api/public/events/${encodeURIComponent(eventId)}/board${query}`,
    {
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) throw new Error("Öffentliche Anzeige nicht verfügbar.");
  return publicBoardSchema.parse(await response.json());
}

export async function getOperationBoard(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  signal?: AbortSignal,
): Promise<OperationBoard> {
  const response = await apiFetch(`/api/events/${encodeURIComponent(eventId)}/operations`, {
    ...(LEGACY_DEVELOPMENT_DEVICE_AUTH && deviceToken
      ? { headers: deviceHeaders(deviceId, deviceToken) }
      : {}),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Betriebsdaten nicht verfügbar (${response.status})`);
  return operationBoardSchema.parse(await response.json());
}

export async function sendCommand(
  command: CommandEnvelope,
  deviceToken: string,
): Promise<CommandResult> {
  assertOperationalConnection(navigator.onLine);
  const { deviceId: _browserDeviceId, ...sessionCommand } = command;
  const response = await apiFetch(`/api/events/${encodeURIComponent(command.eventId)}/commands`, {
    method: "POST",
    headers: deviceHeaders(command.deviceId, deviceToken, { "content-type": "application/json" }),
    body: JSON.stringify(LEGACY_DEVELOPMENT_DEVICE_AUTH ? command : sessionCommand),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Kommando abgelehnt (${response.status})`);
  }
  return commandResultSchema.parse(await response.json());
}

export function assertOperationalConnection(online: boolean): void {
  if (!online) throw new Error("Offline: operative Aktion benötigt eine Serverbestätigung.");
}

export async function getPublicTicketStatus(
  ticketCode: string,
  signal?: AbortSignal,
): Promise<PublicTicketStatus> {
  const response = await apiFetch(`/api/public/tickets/${encodeURIComponent(ticketCode)}`, {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("Ticket nicht gefunden.");
  return publicTicketStatusSchema.parse(await response.json());
}

export type PushConfiguration =
  | { configured: true; publicKey: string; retentionDays: number }
  | { configured: false };

export async function getPushConfiguration(signal?: AbortSignal): Promise<PushConfiguration> {
  const response = await apiFetch("/api/public/push/config", signal ? { signal } : {});
  if (response.status === 503) return { configured: false };
  if (!response.ok) throw new Error("Web-Push-Konfiguration ist nicht erreichbar.");
  const body = (await response.json()) as { publicKey?: string; retentionDays?: number };
  if (
    typeof body.publicKey !== "string" ||
    body.publicKey.length < 80 ||
    !Number.isInteger(body.retentionDays)
  ) {
    throw new Error("Web-Push-Konfiguration ist unvollständig.");
  }
  return {
    configured: true,
    publicKey: body.publicKey,
    retentionDays: body.retentionDays as number,
  };
}

export async function getPushPublicKey(): Promise<string> {
  const configuration = await getPushConfiguration();
  if (!configuration.configured) throw new Error("Web-Push ist noch nicht eingerichtet.");
  return configuration.publicKey;
}

export async function registerTicketPush(
  ticketCode: string,
  subscription: PushSubscription,
): Promise<void> {
  const response = await apiFetch(
    `/api/public/tickets/${encodeURIComponent(ticketCode)}/push-subscriptions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent: true, ...subscription.toJSON() }),
    },
  );
  if (!response.ok) throw new Error("Web-Push konnte nicht aktiviert werden.");
}

export async function revokeTicketPush(ticketCode: string, endpoint: string): Promise<void> {
  const response = await apiFetch(
    `/api/public/tickets/${encodeURIComponent(ticketCode)}/push-subscriptions`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    },
  );
  if (!response.ok) throw new Error("Web-Push konnte nicht deaktiviert werden.");
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await apiFetch("/api/health", signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(`Healthcheck fehlgeschlagen (${response.status})`);
  }
  return (await response.json()) as HealthResponse;
}

export async function getDemoSnapshot(signal?: AbortSignal): Promise<EventSnapshot> {
  const response = await apiFetch("/api/events/demo-2026/snapshot", signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(`Demo-Snapshot nicht verfügbar (${response.status})`);
  }
  return eventSnapshotSchema.parse(await response.json());
}
