import {
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

export interface HealthResponse {
  ok: boolean;
  service: string;
  environment: string;
  requirementsVersion: string;
  timestamp: string;
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
