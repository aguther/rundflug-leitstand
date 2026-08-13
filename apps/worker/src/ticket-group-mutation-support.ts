import type { CommandEnvelope } from "@rundflug/contracts";
import type { NonCanceledRotationState } from "@rundflug/domain";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export function ticketGroupMutationJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export type TicketGroupMutationCommand = Extract<
  CommandEnvelope,
  { type: "CANCEL_TICKET_GROUP" | "DEFER_TICKET_GROUP" | "MARK_NO_SHOW" }
>;

export interface TicketGroupMutationRow {
  id: string;
  product_id: string;
  version: number;
  deferral_count: number;
  resource_group_id: string;
  group_size: number;
}

export interface TicketGroupRotationRow {
  id: string;
  status: NonCanceledRotationState;
  called_at: string | null;
  aircraft_id: string | null;
  rotation_group_count: number;
}

export function queueMutationAction(commandType: TicketGroupMutationCommand["type"]) {
  if (commandType === "CANCEL_TICKET_GROUP") return "CANCEL" as const;
  if (commandType === "MARK_NO_SHOW") return "NO_SHOW" as const;
  return "DEFER" as const;
}

export function terminalTicketStatus(
  commandType: TicketGroupMutationCommand["type"],
): "CANCELED" | "NO_SHOW" | "CLARIFICATION" {
  if (commandType === "CANCEL_TICKET_GROUP") return "CANCELED";
  if (commandType === "MARK_NO_SHOW") return "NO_SHOW";
  return "CLARIFICATION";
}
