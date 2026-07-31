import { describe, expect, it } from "vitest";
import migration from "../migrations/0057_turnaround_phase_overrides.sql?raw";
import coordinatorSource from "./event-coordinator.ts?raw";
import workerSource from "./index.ts?raw";

describe("turnaround phase override persistence", () => {
  it("adds nullable product phases and a versioned aircraft-product table", () => {
    expect(migration).toContain("planned_boarding_minutes_override");
    expect(migration).toContain("aircraft_product_turnaround_overrides");
    expect(migration).toContain("PRIMARY KEY (operation_day_id, aircraft_id, product_id)");
    expect(migration).toContain("version INTEGER NOT NULL DEFAULT 0");
  });

  it("persists admin commands with audit, idempotency and outbox entries", () => {
    expect(coordinatorSource).toContain("handleAircraftProductTurnaroundOverride");
    expect(coordinatorSource).toContain("TURNAROUND_OVERRIDE_STALE_VERSION");
    expect(coordinatorSource).toContain("AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE_UPSERTED");
    expect(coordinatorSource).toContain("idempotency_receipts");
    expect(coordinatorSource).toContain("EVENT_STATE_CHANGED");
  });

  it("projects effective values and their source without exposing them to public boards", () => {
    expect(workerSource).toContain("resolveTurnaroundProfile");
    expect(workerSource).toContain("aircraftProductTurnaroundOverrides");
    expect(workerSource).toContain("effectiveTurnaroundProfile");
  });
});
