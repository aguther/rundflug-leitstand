import type { PushConfigurationStatus } from "./AdminOverviewPanel";

export function pushSubscriptionCount(
  status: PushConfigurationStatus,
  activeSubscriptions: number,
): number | string {
  if (status === "configured") return activeSubscriptions;
  return status === "loading" ? "…" : "–";
}

export function pushStatusLabel(status: PushConfigurationStatus): string {
  if (status === "configured") return "Web-Push aktiv";
  if (status === "missing") return "Web-Push fehlt";
  if (status === "loading") return "Web-Push wird geprüft";
  return "Web-Push nicht geprüft";
}
