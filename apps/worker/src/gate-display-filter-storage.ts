export const EMPTY_GATE_DISPLAY_FILTER_JSON = '{"productIds":[],"rotationStatuses":[]}';

export type GateDisplayFilterSchemaMode = "current" | "legacy";

function isMissingGateDisplayFilterColumn(error: unknown): boolean {
  return (
    error instanceof Error && /no such column:\s*(?:g\.)?display_filter_json\b/i.test(error.message)
  );
}

export async function withGateDisplayFilterFallback<T>(
  query: (mode: GateDisplayFilterSchemaMode) => Promise<T>,
): Promise<T> {
  try {
    return await query("current");
  } catch (error) {
    if (!isMissingGateDisplayFilterColumn(error)) throw error;
    return query("legacy");
  }
}
