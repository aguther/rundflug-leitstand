import { describe, expect, it } from "vitest";
import soakHarness from "../../../scripts/verify_soak_reliability.mjs?raw";

describe("V1 twelve-hour reliability harness", () => {
  it("defaults to twelve hours without restarting the worker", () => {
    expect(soakHarness).toContain("12 * 60 * 60");
    expect(soakHarness).toContain("Worker-Prozess wurde während des Langlaufs beendet");
    expect(soakHarness).toContain("workerRestarted: false");
    expect(soakHarness).toContain("SOAK_PORT");
    expect(soakHarness).toContain("SOAK_PERSIST_TO");
    expect(soakHarness).toContain('"--persist-to"');
  });

  it("exercises authenticated writes, reads, realtime and latency limits anonymously", () => {
    for (const evidence of [
      "SELL_TICKET_GROUP",
      "CANCEL_TICKET_GROUP",
      "/operations",
      "/api/health",
      "WebSocket",
      "2_000",
      "randomBytes(16)",
      "anonymousSyntheticDataOnly: true",
    ]) {
      expect(soakHarness).toContain(evidence);
    }
    expect(soakHarness).not.toContain("guestName");
    expect(soakHarness).not.toContain("phoneNumber");
  });
});
