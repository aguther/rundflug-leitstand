import { describe, expect, it } from "vitest";
import {
  exclusiveSuites,
  isolatedSuites,
  runIntegrationSchedule,
  runSuiteLanes,
  serialSuites,
  suites,
} from "../../../scripts/verify_v1_integrations.mjs";

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  }
  throw new Error("The expected scheduler state was not reached.");
}

describe("V1 integration suite scheduling", () => {
  it("assigns every integration suite to exactly one state-isolation lane", () => {
    expect(exclusiveSuites).toHaveLength(12);
    expect(isolatedSuites).toHaveLength(5);
    expect(serialSuites).toEqual(["test:automatic-precall"]);
    const assignedSuites = new Set([...exclusiveSuites, ...isolatedSuites, ...serialSuites]);
    expect(assignedSuites).toEqual(new Set(suites));
    expect(assignedSuites.size).toBe(suites.length);
  });

  it("runs serial suites only after both concurrent lanes complete", async () => {
    const started: string[] = [];
    const pending = new Map<string, () => void>();
    const execution = runIntegrationSchedule({
      lanes: [
        { name: "exclusive", laneSuites: ["exclusive-1"] },
        { name: "isolated", laneSuites: ["isolated-1"] },
      ],
      serialSuites: ["serial-1"],
      runSuite: (suite: string, lane: string) => {
        started.push(suite);
        return new Promise((resolvePromise) => {
          pending.set(suite, () => resolvePromise({ suite, lane }));
        });
      },
    });

    await waitFor(() => pending.size === 2);
    expect(started).toEqual(["exclusive-1", "isolated-1"]);
    expect(started).not.toContain("serial-1");

    pending.get("exclusive-1")?.();
    pending.get("isolated-1")?.();
    await waitFor(() => pending.has("serial-1"));
    expect(started).toEqual(["exclusive-1", "isolated-1", "serial-1"]);
    pending.get("serial-1")?.();

    await expect(execution).resolves.toEqual([
      { suite: "exclusive-1", lane: "exclusive" },
      { suite: "isolated-1", lane: "isolated" },
      { suite: "serial-1", lane: "serial" },
    ]);
  });

  it("runs both lanes concurrently while keeping each lane sequential", async () => {
    const started: string[] = [];
    const pending = new Map<string, () => void>();
    const execution = runSuiteLanes({
      lanes: [
        { name: "exclusive", laneSuites: ["exclusive-1", "exclusive-2"] },
        { name: "isolated", laneSuites: ["isolated-1", "isolated-2"] },
      ],
      runSuite: (suite: string, lane: string) => {
        started.push(suite);
        return new Promise((resolvePromise) => {
          pending.set(suite, () => resolvePromise({ suite, lane }));
        });
      },
    });

    await waitFor(() => pending.size === 2);
    expect(started).toEqual(["exclusive-1", "isolated-1"]);

    pending.get("exclusive-1")?.();
    await waitFor(() => pending.has("exclusive-2"));
    expect(started).toEqual(["exclusive-1", "isolated-1", "exclusive-2"]);
    expect(started).not.toContain("isolated-2");

    pending.get("isolated-1")?.();
    await waitFor(() => pending.has("isolated-2"));
    pending.get("exclusive-2")?.();
    pending.get("isolated-2")?.();

    await expect(execution).resolves.toEqual([
      { suite: "exclusive-1", lane: "exclusive" },
      { suite: "exclusive-2", lane: "exclusive" },
      { suite: "isolated-1", lane: "isolated" },
      { suite: "isolated-2", lane: "isolated" },
    ]);
  });
});
