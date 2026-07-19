import { describe, expect, it } from "vitest";
import migration from "../migrations/0033_flight_line_assist_claims.sql?raw";
import { FACTORY_RESET_DELETE_TABLES } from "./factory-reset";
import workerSource from "./index.ts?raw";

describe("anonyme Flight-Line-Assist-Betreuungsreservierung (F-INT-070)", () => {
  it("stores at most one expiring device claim per aircraft", () => {
    expect(migration).toContain("PRIMARY KEY (operation_day_id, aircraft_id)");
    expect(migration).toContain("expires_at TEXT NOT NULL");
    expect(workerSource).toContain("flight_line_assist_claims.expires_at <= excluded.claimed_at");
    expect(workerSource).toContain("AIRCRAFT_ASSIST_CLAIMED");
  });

  it("requires an authorized operational session without exposing its technical ID", () => {
    expect(workerSource).toContain(
      'app.on("PUT", eventRoutes("/assist-claims/:aircraftId"), async (context) => {',
    );
    expect(workerSource).toContain('["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]');
    expect(workerSource).toContain("assistClaims: assistClaims.map");
    expect(workerSource).toContain("claimedByCurrentSession: claim.device_id === device.id");
    expect(migration).not.toMatch(/name|phone|email/i);
  });

  it("removes ephemeral claims during a full factory reset", () => {
    expect(FACTORY_RESET_DELETE_TABLES[0]).toBe("flight_line_assist_claims");
  });
});
