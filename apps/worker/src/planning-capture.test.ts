import type { ForecastTimelinesInput } from "@rundflug/domain";
import { describe, expect, it } from "vitest";
import planningMigration from "../migrations/0062_hybrid_planning_capture.sql?raw";
import backupSource from "./backup.ts?raw";
import coordinatorSource from "./event-coordinator.ts?raw";
import eventDeletionSource from "./event-deletion.ts?raw";
import factoryResetSource from "./factory-reset.ts?raw";
import {
  canonicalPlanningChunk,
  canonicalPlanningJson,
  PLANNING_CHUNK_ENTITY_LIMIT,
  planningContextChunkValues,
} from "./planning-capture";
import planningCaptureSource from "./planning-capture.ts?raw";

function forecastInput(rotationCount = 1): ForecastTimelinesInput {
  return {
    event: {
      eventId: "event-synthetic",
      now: "2026-08-02T10:00:00.000Z",
      plannedOperationsStartAt: "2026-08-02T08:00:00.000Z",
      plannedOperationsEndAt: "2026-08-02T20:00:00.000Z",
      operationalInterrupted: false,
      emergencyMode: false,
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 4,
      plannedBufferMinutes: 2,
    },
    capacities: [
      {
        resourceGroupId: "resource-a",
        activeAircraft: 1,
        availabilityLanes: [
          {
            laneId: "aircraft-a:pilot-a",
            aircraftId: "aircraft-a",
            pilotId: "pilot-a",
            passengerSeats: 4,
            availableLowerAt: "2026-08-02T10:00:00.000Z",
            availableExpectedAt: "2026-08-02T10:00:00.000Z",
            availableUpperAt: "2026-08-02T10:00:00.000Z",
          },
        ],
      },
    ],
    durationSamples: [],
    rotations: Array.from({ length: rotationCount }, (_, index) => ({
      id: `rotation-${String(index).padStart(3, "0")}`,
      status: "DRAFT" as const,
      createdAt: "2026-08-02T09:00:00.000Z",
      calledAt: null,
      departedAt: null,
      landedAt: null,
      resourceGroupId: "resource-a",
      resourceGroupStatus: "ACTIVE" as const,
      queueSequence: index + 1,
      referenceDurationMinutes: 20,
      productCode: "RUNDÖ",
      aircraftType: null,
      predictedDepartureAt: null,
      predictedLandingAt: null,
      predictedCompletionAt: null,
    })),
  };
}

describe("hybrid planning capture", () => {
  it("canonicalizes object keys while preserving array order and exact strings", async () => {
    const left = await canonicalPlanningChunk("EVENT_CONFIGURATION", {
      z: ["ä", "2026-08-02T10:00:00.000Z"],
      a: { second: 2, first: 1 },
    });
    const right = await canonicalPlanningChunk("EVENT_CONFIGURATION", {
      a: { first: 1, second: 2 },
      z: ["ä", "2026-08-02T10:00:00.000Z"],
    });
    const reordered = await canonicalPlanningChunk("EVENT_CONFIGURATION", {
      a: { first: 1, second: 2 },
      z: ["2026-08-02T10:00:00.000Z", "ä"],
    });

    expect(left).toEqual(right);
    expect(reordered.hash).not.toBe(left.hash);
    expect(left.json).toContain("ä");
    expect(left.byteSize).toBe(new TextEncoder().encode(left.json).byteLength);
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalPlanningJson({ duration: Number.POSITIVE_INFINITY })).toThrow(
      "is not finite",
    );
  });

  it("keeps calculation time outside chunks and partitions entity sets at fifty", () => {
    const chunks = planningContextChunkValues(forecastInput(121));
    const serialized = chunks.map((chunk) => canonicalPlanningJson(chunk.value)).join("\n");
    const rotationChunks = chunks.filter((chunk) => chunk.kind === "ROTATIONS_QUEUE");

    expect(serialized).not.toContain('"now"');
    expect(rotationChunks).toHaveLength(3);
    expect(
      rotationChunks.every(
        (chunk) => Array.isArray(chunk.value) && chunk.value.length <= PLANNING_CHUNK_ENTITY_LIMIT,
      ),
    ).toBe(true);
  });

  it("links snapshots and maintains append-only lifecycle coverage", () => {
    expect(planningMigration).toContain("CREATE TABLE planning_chunks");
    expect(planningMigration).toContain("CREATE TABLE planning_contexts");
    expect(planningMigration).toContain("CREATE TABLE planning_runs");
    expect(planningMigration).toContain("CHECK (replay_distance BETWEEN 0 AND 10)");
    expect(planningMigration).toContain(
      "ALTER TABLE forecast_snapshots ADD COLUMN planning_run_id",
    );
    expect(coordinatorSource).toContain("preparePlanningCapture");
    expect(coordinatorSource).toContain("planningRunId");
    expect(planningCaptureSource).toContain("PLANNING_CAPTURE_COMPLETION_FAILED");
    expect(coordinatorSource).toContain("? Number.MAX_SAFE_INTEGER");
    expect(coordinatorSource).not.toContain("? Number.POSITIVE_INFINITY");
    expect(coordinatorSource).not.toContain(
      "if (!event || rotationRows.results.length === 0) return;",
    );
    for (const table of ["planning_chunks", "planning_contexts", "planning_runs"]) {
      expect(backupSource).toContain(`"${table}"`);
      expect(eventDeletionSource).toContain(`DELETE FROM ${table}`);
      expect(factoryResetSource).toContain(`"${table}"`);
    }
  });
});
