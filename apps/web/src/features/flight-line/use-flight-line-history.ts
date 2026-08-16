import type { ForecastHistory } from "@rundflug/contracts";
import { useCallback } from "react";
import { getForecastHistory, getResourceDayHistory } from "../../api";

interface FlightLineHistoryOptions {
  deviceId: string;
  deviceToken: string;
  eventId: string;
}

export function useFlightLineHistory({ deviceId, deviceToken, eventId }: FlightLineHistoryOptions) {
  const loadAllForecastHistory = useCallback(
    async (rotationId: string): Promise<ForecastHistory["entries"]> => {
      const entries: ForecastHistory["entries"] = [];
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;
      while (offset < total) {
        const page = await getForecastHistory(eventId, deviceId, deviceToken, {
          rotationId,
          limit: 200,
          offset,
        });
        entries.push(...page.entries);
        total = page.total;
        offset += page.entries.length;
        if (page.entries.length === 0) break;
        if (offset > 100_000 && offset < total) {
          throw new Error("Der Prognoseverlauf überschreitet die abrufbare Tagesmenge.");
        }
      }
      return entries.sort(
        (left, right) =>
          Date.parse(left.capturedAt) - Date.parse(right.capturedAt) ||
          left.snapshotId.localeCompare(right.snapshotId),
      );
    },
    [deviceId, deviceToken, eventId],
  );
  const loadResourceHistory = useCallback(
    (scopeType: "AIRCRAFT" | "PILOT", scopeId: string) =>
      getResourceDayHistory(eventId, deviceId, deviceToken, { scopeType, scopeId }),
    [deviceId, deviceToken, eventId],
  );
  return { loadAllForecastHistory, loadResourceHistory };
}
