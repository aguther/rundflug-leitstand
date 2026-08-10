import type { OperationBoard } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import {
  adminAreaCopy,
  adminEventStepCopy,
  createAdminSetupSteps,
  summarizeAdminSetup,
} from "./admin-shell-model";

function boardWithSetup(overrides: Partial<OperationBoard> = {}): OperationBoard {
  return {
    event: {
      status: "PREPARATION",
      saleOpensAt: "2026-08-10T08:00:00.000Z",
      operationsEndAt: "2026-08-10T18:00:00.000Z",
    },
    gates: [{ active: true }],
    resourceGroups: [{ activeAircraftIds: ["aircraft-a"] }],
    aircraft: [{ id: "aircraft-a" }],
    pilots: [{ active: true }],
    products: [{ id: "product-a" }],
    plannedOperations: [],
    recurringOperationalRules: [],
    ...overrides,
  } as unknown as OperationBoard;
}

describe("admin shell model", () => {
  it("keeps page copy complete for every navigation target", () => {
    expect(Object.keys(adminAreaCopy)).toEqual([
      "overview",
      "events",
      "users",
      "evaluation",
      "backup",
    ]);
    expect(Object.keys(adminEventStepCopy)).toEqual([
      "event",
      "gates",
      "resource-groups",
      "aircraft",
      "pilots",
      "products",
      "operational-plan",
      "operations",
      "completion",
    ]);
  });

  it("counts only the six required setup steps", () => {
    const steps = createAdminSetupSteps(boardWithSetup());
    expect(summarizeAdminSetup(steps)).toEqual({ complete: true, completedSteps: 6 });
    expect(steps.find((step) => step.id === "operational-plan")?.complete).toBe(false);
  });

  it("reports incomplete master data without treating later lifecycle steps as required", () => {
    const steps = createAdminSetupSteps(
      boardWithSetup({
        event: { status: "ARCHIVED" } as OperationBoard["event"],
        resourceGroups: [{ activeAircraftIds: [] }] as unknown as OperationBoard["resourceGroups"],
      }),
    );

    expect(summarizeAdminSetup(steps)).toEqual({ complete: false, completedSteps: 5 });
    expect(steps.find((step) => step.id === "operations")?.complete).toBe(true);
    expect(steps.find((step) => step.id === "completion")?.complete).toBe(true);
  });
});
