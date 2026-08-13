import type { assessForecastFreshness, derivePublicRotationStatus } from "@rundflug/domain";
import { PUBLIC_STATUS_MESSAGES, publicServicePausedMessage } from "./public-status-copy";

export type PredictionQuality = "STABLE" | "CHANGING" | "UNCERTAIN";
export type ResourceGroupStatus = "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";

type PublicRotationStatus = ReturnType<typeof derivePublicRotationStatus>;
type ForecastFreshnessReason = ReturnType<typeof assessForecastFreshness>["reason"];

export interface PublicServiceState {
  emergencyMode: boolean;
  operationalInterrupted: boolean;
  resourceGroupStatus: ResourceGroupStatus;
}

export function hasPublicServicePause(state: PublicServiceState): boolean {
  return (
    state.emergencyMode || state.operationalInterrupted || state.resourceGroupStatus !== "ACTIVE"
  );
}

export function publicPredictionQuality(
  state: PublicServiceState,
  forecastQuality: PredictionQuality,
): PredictionQuality {
  if (
    state.emergencyMode ||
    state.operationalInterrupted ||
    state.resourceGroupStatus === "INTERRUPTED" ||
    state.resourceGroupStatus === "ENDED"
  ) {
    return "UNCERTAIN";
  }
  return forecastQuality;
}

export function publicDraftStatus(
  precalledAt: string | null,
  prepare: boolean,
): "COME_TO_FLIGHT_LINE" | "PREPARE" | "WAITING" {
  if (precalledAt) return "COME_TO_FLIGHT_LINE";
  if (prepare) return "PREPARE";
  return "WAITING";
}

interface PublicStatusMessageOptions extends PublicServiceState {
  forecastFreshnessReason: ForecastFreshnessReason;
  lifecycleStatus: PublicRotationStatus;
  servicePaused: boolean;
}

export function publicStatusMessage({
  emergencyMode,
  forecastFreshnessReason,
  lifecycleStatus,
  operationalInterrupted,
  resourceGroupStatus,
  servicePaused,
}: PublicStatusMessageOptions): string {
  if (servicePaused) {
    return publicServicePausedMessage({
      emergencyMode,
      resourceGroupActive: resourceGroupStatus === "ACTIVE",
      operationalInterrupted,
    });
  }
  if (forecastFreshnessReason === "STALE_PREDICTION") {
    return "Prognose wird aktualisiert – bitte Status erneut prüfen.";
  }
  return PUBLIC_STATUS_MESSAGES[lifecycleStatus];
}
