import { describe, expect, it } from "vitest";
import migration from "../migrations/0034_automatic_precall.sql?raw";
import coordinatorSource from "./event-coordinator.ts?raw";

describe("persistierter automatischer Voraufruf (F-BEN-030)", () => {
  it("stores a distinct precall without binding an aircraft or changing the rotation", () => {
    expect(migration).toContain("ALTER TABLE flight_groups ADD COLUMN precalled_at TEXT");
    expect(coordinatorSource).toContain("selectAutomaticPrecalls");
    expect(coordinatorSource).toContain("FLIGHT_GROUP_PRECALLED");
    expect(coordinatorSource).toContain('trigger: "AUTOMATIC_PRECALL"');
    const persistence = coordinatorSource.slice(
      coordinatorSource.indexOf("private async persistAutomaticPrecalls"),
      coordinatorSource.indexOf("private async handleFleetAdministration"),
    );
    expect(persistence).toContain("UPDATE flight_groups");
    expect(persistence).not.toMatch(/UPDATE rotations|aircraft_id\s*=/i);
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
    expect(decision).toContain("minutesSinceLastGatePrecall");
    expect(decision).not.toContain("maximumGateWaitMinutes");
    expect(decision).not.toContain("precallMinimumQuality");
  });

  it("selects the stable queue batch from one forecast and gate-cooldown snapshot", () => {
    const recalculation = coordinatorSource.slice(
      coordinatorSource.indexOf("private async recalculateForecastTimelines"),
      coordinatorSource.indexOf("private async persistAutomaticPrecalls"),
    );
    expect(recalculation).toContain("const precallQueueEntries");
    expect(recalculation).toContain("selectAutomaticPrecalls(precallQueueEntries)");
    expect(recalculation).toContain("const lastGatePrecall");
    expect(recalculation).not.toContain("lastGatePrecall.set(rotation.gate_id, now.getTime())");
  });

  it("excludes rotations overlapping event interruptions from the normal learning basis", () => {
    expect(coordinatorSource).toContain("EVENT_OPERATION_INTERRUPTED");
    expect(coordinatorSource).toContain("EVENT_OPERATION_RESUMED");
    expect(coordinatorSource).toContain("EMERGENCY_MODE_CLEARED");
  });
});
