import { describe, expect, it } from "vitest";
import migration from "../migrations/0034_automatic_precall.sql?raw";
import decisionMigration from "../migrations/0052_precall_decisions.sql?raw";
import coordinatorSource from "./event-coordinator.ts?raw";

describe("persistierter automatischer Voraufruf (F-BEN-030)", () => {
  it("stores a distinct precall without binding an aircraft or changing the rotation", () => {
    expect(migration).toContain("ALTER TABLE flight_groups ADD COLUMN precalled_at TEXT");
    expect(coordinatorSource).toContain("selectAutomaticPrecalls");
    expect(coordinatorSource).toContain("FLIGHT_GROUP_PRECALLED");
    expect(coordinatorSource).toContain('trigger: "AUTOMATIC_PRECALL"');
    const persistence = coordinatorSource.slice(
      coordinatorSource.indexOf("private async persistAutomaticPrecalls"),
      coordinatorSource.indexOf("private async handlePlannedOperation"),
    );
    expect(persistence).toContain("UPDATE flight_groups");
    expect(persistence).not.toMatch(/UPDATE rotations|aircraft_id\s*=/i);
    expect(decisionMigration).toContain("precall_decision_reason");
  });

  it("keeps the system command optimistic, idempotent and auditable", () => {
    expect(coordinatorSource).toContain("version = ?3");
    expect(coordinatorSource).toContain("version = ?6 AND precalled_at IS NULL");
    expect(coordinatorSource).toContain("precall_trigger = ?1");
    expect(coordinatorSource).toContain("'SYSTEM', 'FLIGHT_GROUP'");
    expect(coordinatorSource).toContain("blockedResourceGroups.add(candidate.resourceGroupId)");
  });

  it("re-evaluates active events independently of operator commands", () => {
    expect(coordinatorSource).toContain("async alarm(): Promise<void>");
    expect(coordinatorSource).toContain('"AUTOMATIC_FORECAST_TICK"');
    expect(coordinatorSource).toContain("FORECAST_TICK_INTERVAL_MS = 30_000");
    expect(coordinatorSource).toContain("this.ctx.storage.setAlarm");
  });

  it("treats gate wait as an adaptive target rather than a hard stop", () => {
    const decision = coordinatorSource.slice(
      coordinatorSource.indexOf("const precallQueueEntries"),
      coordinatorSource.indexOf("const precallCandidates"),
    );
    expect(decision).toContain("adaptiveLeadMinutes");
    expect(decision).toContain("forecastCapacityStatus");
    expect(decision).not.toContain("maximumGateWaitMinutes");
    expect(decision).not.toContain("precallMinimumQuality");
    expect(decision).not.toContain("minutesSinceLastGatePrecall");
    expect(coordinatorSource).not.toContain("SYSTEM_GATE_COOLDOWN_MINUTES");
  });

  it("selects a stable queue prefix without a cross-resource gate cooldown", () => {
    const recalculation = coordinatorSource.slice(
      coordinatorSource.indexOf("private async recalculateForecastTimelines"),
      coordinatorSource.indexOf("private async persistAutomaticPrecalls"),
    );
    expect(recalculation).toContain("const precallQueueEntries");
    expect(recalculation).toContain("selectAutomaticPrecalls(precallQueueEntries)");
    expect(recalculation).not.toContain("lastGatePrecall");
    expect(recalculation).toContain("precall_decision_status");
    expect(decisionMigration).toContain("'NO_FORECAST_CAPACITY'");
  });

  it("uses seat-aware lanes and allocates every pilot at most once per forecast", () => {
    expect(coordinatorSource).toContain("passengerSeats: aircraft.passengerSeats");
    expect(coordinatorSource).toContain("const usedPilotIds = new Set<string>()");
    expect(coordinatorSource).toContain("currentPilotId: aircraft.current_pilot_id");
    expect(coordinatorSource).toContain("usedPilotIds.add(pilot.pilotId)");
  });

  it("excludes rotations overlapping event interruptions from the normal learning basis", () => {
    expect(coordinatorSource).toContain("EVENT_OPERATION_INTERRUPTED");
    expect(coordinatorSource).toContain("EVENT_OPERATION_RESUMED");
    expect(coordinatorSource).toContain("EMERGENCY_MODE_CLEARED");
  });
});
