import { describe, expect, it } from "vitest";
import migration from "../migrations/0039_operator_owned_flight_line_claims.sql?raw";
import { FACTORY_RESET_DELETE_TABLES } from "./factory-reset";
import workerSource from "./index.ts?raw";

describe("loginbasierte Flight-Line-Assist-Betreuungsreservierung (F-INT-070)", () => {
  it("stores at most one expiring login claim per aircraft", () => {
    expect(migration).toContain("PRIMARY KEY (operation_day_id, aircraft_id)");
    expect(migration).toContain("operator_account_id TEXT NOT NULL");
    expect(migration).toContain("UNIQUE (operation_day_id, operator_account_id)");
    expect(migration).toContain("expires_at TEXT NOT NULL");
  });

  it("projects account-owned claims without exposing personal data", () => {
    expect(workerSource).toContain("assistClaims: assistClaims.map");
    expect(workerSource).toContain("claimedByCurrentOperator:");
    expect(workerSource).toContain("claim.operator_account_id === device.accountId");
    expect(migration).not.toMatch(/phone|email/i);
  });

  it("removes ephemeral claims during a full factory reset", () => {
    expect(FACTORY_RESET_DELETE_TABLES).toContain("flight_line_assist_claims");
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("dispatch_recommendation_leases")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("flight_line_assist_claims"),
    );
  });
});
