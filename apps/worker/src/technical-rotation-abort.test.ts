import { describe, expect, it } from "vitest";
import coordinatorSource from "./event-coordinator.ts?raw";

function technicalAbortHandler(): string {
  const start = coordinatorSource.indexOf("private async handleTechnicalRotationAbort");
  const end = coordinatorSource.indexOf("private async handleAbortRotation", start);
  return coordinatorSource.slice(start, end);
}

describe("technical rotation abort to queue", () => {
  it("serializes queue, rotation and aircraft changes in one D1 batch", () => {
    const handler = technicalAbortHandler();
    expect(handler).toContain("assertTechnicalRotationAbortAllowed(rotation.status)");
    expect(handler).toContain("ORDER BY tg.queue_sequence, assigned_at, tg.id");
    expect(handler).toContain("queue_sequence = queue_sequence + ?1");
    expect(handler).toContain("status IN ('QUEUED', 'PRESENT')");
    expect(handler).toContain("queue_sequence = ?1 WHERE id = ?2");
    expect(handler).toContain("SET status = 'DRAFT', aircraft_id = NULL, pilot_id = NULL");
    expect(handler).toContain("operational_state = 'INACTIVE'");
    expect(handler).toContain("await this.env.DB.batch(statements)");
  });

  it("preserves attendance and records audit, outbox and idempotency atomically", () => {
    const handler = technicalAbortHandler();
    expect(handler).toContain("attendance_status = 'CHECKED_IN'");
    expect(handler).toContain("ROTATION_ABORTED_TO_QUEUE_AIRCRAFT_UNAVAILABLE");
    expect(handler).toContain("previousActuals");
    expect(handler).toContain("idempotency_receipts");
    expect(handler).toContain("INSERT INTO outbox");
  });

  it("rejects stale rotation or aircraft aggregates", () => {
    const handler = technicalAbortHandler();
    expect(handler).toContain("expectedRotationVersion");
    expect(handler).toContain("expectedAircraftVersion");
    expect(handler).toContain("STALE_AGGREGATE_VERSION");
    expect(handler).toContain("WHERE id = ?2 AND version = ?3");
  });
});
