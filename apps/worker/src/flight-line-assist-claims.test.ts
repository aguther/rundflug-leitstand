import { describe, expect, it } from "vitest";
import migration from "../migrations/0039_operator_owned_flight_line_claims.sql?raw";
import coordinatorSource from "./event-coordinator.ts?raw";
import { FACTORY_RESET_DELETE_TABLES } from "./factory-reset";
import workerSource from "./index.ts?raw";

describe("loginbasierte Flight-Line-Assist-Betreuungsreservierung (F-INT-070)", () => {
  it("stores at most one expiring login claim per aircraft", () => {
    expect(migration).toContain("PRIMARY KEY (operation_day_id, aircraft_id)");
    expect(migration).toContain("operator_account_id TEXT NOT NULL");
    expect(migration).toContain("UNIQUE (operation_day_id, operator_account_id)");
    expect(migration).toContain("expires_at TEXT NOT NULL");
    expect(coordinatorSource).toContain(
      "flight_line_assist_claims.expires_at <= excluded.claimed_at",
    );
    expect(coordinatorSource).toContain("AIRCRAFT_ASSIST_CLAIM_ACQUIRED");
    expect(coordinatorSource).toContain("30 * 60_000");
  });

  it("requires an authorized operational session without exposing its technical ID", () => {
    expect(workerSource).toContain(
      'app.on("PUT", eventRoutes("/assist-claims/:aircraftId"), async (context) => {',
    );
    expect(workerSource).toContain('["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"]');
    expect(workerSource).toContain("assistClaims: assistClaims.map");
    expect(workerSource).toContain("claimedByCurrentOperator:");
    expect(workerSource).toContain("claim.operator_account_id === device.accountId");
    expect(coordinatorSource).toContain("AIRCRAFT_ASSIST_CLAIM_TAKEN_OVER");
    expect(coordinatorSource).toContain("expectedRevision !== active.revision");
    expect(migration).not.toMatch(/phone|email/i);
  });

  it("removes ephemeral claims during a full factory reset", () => {
    expect(FACTORY_RESET_DELETE_TABLES[0]).toBe("flight_line_assist_claims");
  });
});
