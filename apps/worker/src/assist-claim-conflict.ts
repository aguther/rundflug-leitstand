export function assistClaimConflictCode(action: "ACQUIRE_OR_RENEW" | "TAKEOVER"): string {
  return action === "TAKEOVER" ? "AIRCRAFT_ASSIST_CLAIM_CHANGED" : "AIRCRAFT_ASSIST_CLAIMED";
}
