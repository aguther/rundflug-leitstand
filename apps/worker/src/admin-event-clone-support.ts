import type {
  AdminEventCloneErrorResponse,
  AdminEventCloneResult,
} from "./admin-event-clone-service";

export function remapOptionalId(
  value: unknown,
  mappedIds: ReadonlyMap<string, string>,
  field: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new TypeError(`${field} must contain a text identifier.`);
  }
  const mappedId = mappedIds.get(value);
  if (!mappedId) throw new TypeError(`${field} references an unknown identifier.`);
  return mappedId;
}

export function adminEventCloneErrorResult(
  status: 404 | 409,
  code: AdminEventCloneErrorResponse["error"]["code"],
  message: string,
): AdminEventCloneResult {
  return { status, body: { error: { code, message } } };
}
