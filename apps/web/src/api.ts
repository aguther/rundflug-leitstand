import {
  type AuditHistory,
  auditHistorySchema,
  type CommandEnvelope,
  type CommandResult,
  commandResultSchema,
  type EventSnapshot,
  eventSnapshotSchema,
  type OperationBoard,
  operationBoardSchema,
  type PublicBoard,
  type PublicTicketStatus,
  publicBoardSchema,
  publicTicketStatusSchema,
} from "@rundflug/contracts";

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
  const response = await fetch(
    `/api/events/${encodeURIComponent(eventId)}/history?${query.toString()}`,
    {
      headers: { "x-device-id": deviceId, "x-device-token": deviceToken },
    },
  );
  if (!response.ok) throw new Error("Audit-Historie nicht verfügbar.");
  return auditHistorySchema.parse(await response.json());
}

export async function downloadDailyReport(
  eventId: string,
  deviceId: string,
  deviceToken: string,
): Promise<void> {
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/reports/daily.csv`, {
    headers: { "x-device-id": deviceId, "x-device-token": deviceToken },
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
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/${path}`, {
    headers: { "x-device-id": deviceId, "x-device-token": deviceToken },
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

export interface HealthResponse {
  ok: boolean;
  service: string;
  environment: string;
  requirementsVersion: string;
  timestamp: string;
}

export interface PairedDeviceSummary {
  id: string;
  label: string;
  role: string;
  active: boolean;
  online: boolean;
  pairedAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export async function getPairedDevices(
  eventId: string,
  deviceId: string,
  deviceToken: string,
): Promise<PairedDeviceSummary[]> {
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/devices`, {
    headers: { "x-device-id": deviceId, "x-device-token": deviceToken },
  });
  if (!response.ok) throw new Error("Geräteübersicht nicht verfügbar.");
  const body = (await response.json()) as { devices: PairedDeviceSummary[] };
  return body.devices;
}

export async function getPublicBoard(eventId: string, signal?: AbortSignal): Promise<PublicBoard> {
  const response = await fetch(`/api/public/events/${encodeURIComponent(eventId)}/board`, {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("Öffentliche Anzeige nicht verfügbar.");
  return publicBoardSchema.parse(await response.json());
}

export async function getOperationBoard(
  eventId: string,
  deviceId: string,
  deviceToken: string,
  signal?: AbortSignal,
): Promise<OperationBoard> {
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/operations`, {
    headers: { "x-device-id": deviceId, "x-device-token": deviceToken },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Betriebsdaten nicht verfügbar (${response.status})`);
  return operationBoardSchema.parse(await response.json());
}

export async function sendCommand(
  command: CommandEnvelope,
  deviceToken: string,
): Promise<CommandResult> {
  if (!navigator.onLine) {
    throw new Error("Offline: operative Aktion benötigt eine Serverbestätigung.");
  }
  const response = await fetch(`/api/events/${encodeURIComponent(command.eventId)}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": deviceToken },
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Kommando abgelehnt (${response.status})`);
  }
  return commandResultSchema.parse(await response.json());
}

export async function getPublicTicketStatus(
  ticketCode: string,
  signal?: AbortSignal,
): Promise<PublicTicketStatus> {
  const response = await fetch(`/api/public/tickets/${encodeURIComponent(ticketCode)}`, {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("Ticket nicht gefunden.");
  return publicTicketStatusSchema.parse(await response.json());
}

export async function getPushPublicKey(): Promise<string> {
  const response = await fetch("/api/public/push/config");
  if (!response.ok) throw new Error("Web-Push ist noch nicht eingerichtet.");
  const body = (await response.json()) as { publicKey: string };
  return body.publicKey;
}

export async function registerTicketPush(
  ticketCode: string,
  subscription: PushSubscription,
): Promise<void> {
  const response = await fetch(
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
  const response = await fetch(
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
  const response = await fetch("/api/health", signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(`Healthcheck fehlgeschlagen (${response.status})`);
  }
  return (await response.json()) as HealthResponse;
}

export async function getDemoSnapshot(signal?: AbortSignal): Promise<EventSnapshot> {
  const response = await fetch("/api/events/demo-2026/snapshot", signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(`Demo-Snapshot nicht verfügbar (${response.status})`);
  }
  return eventSnapshotSchema.parse(await response.json());
}
