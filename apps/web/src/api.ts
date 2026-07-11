import { type EventSnapshot, eventSnapshotSchema } from "@rundflug/contracts";

export interface HealthResponse {
  ok: boolean;
  service: string;
  environment: string;
  requirementsVersion: string;
  timestamp: string;
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
