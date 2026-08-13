import type { RotationTransitionCommand } from "./rotation-transition-command-service";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export function rotationTransitionJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function dispatchQueueDeviationReason(
  command: RotationTransitionCommand,
  acceptedDispatchRecommendation: boolean,
): string | null {
  if (command.type !== "CALL_NEXT") return null;
  if (command.payload.queueDeviationReason) return command.payload.queueDeviationReason;
  return acceptedDispatchRecommendation ? "CAPACITY_OPTIMIZED_DISPATCH" : null;
}
