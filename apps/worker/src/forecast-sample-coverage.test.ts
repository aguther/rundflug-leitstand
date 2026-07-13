import { describe, expect, it } from "vitest";
import coordinatorSource from "./event-coordinator.ts?raw";

describe("forecast measurement selection", () => {
  it("learns only from completed rotations", () => {
    expect(coordinatorSource).toMatch(
      /SELECT \(julianday\(r\.completed_at\) - julianday\(r\.called_at\)\)[\s\S]*WHERE r\.status = 'COMPLETED'/,
    );
  });

  it("marks active event or resource interruptions as uncertain inputs", () => {
    expect(coordinatorSource).toMatch(
      /interrupted:[\s\S]*event\.operational_interrupted === 1[\s\S]*event\.emergency_mode === 1[\s\S]*rotation\.resource_group_status !== "ACTIVE"/,
    );
  });
});
