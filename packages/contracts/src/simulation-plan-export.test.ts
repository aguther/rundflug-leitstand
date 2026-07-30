import { describe, expect, it } from "vitest";

import { type SimulationPlanExport, simulationPlanExportSchema } from "./index";

const masterData = {
  format: "rundflug-master-data-template",
  formatVersion: 1,
  exportedAt: "2026-07-24T10:00:00.000Z",
  source: { name: "Rundflugtag", version: 4 },
  eventParameters: {
    noShowAfterMinutes: 10,
    maxTicketDeferrals: 2,
    notificationLeadMinutes: 15,
    automaticPrecallEnabled: true,
    precallLeadMinutes: 15,
    maximumGateWaitMinutes: 20,
    precallMinimumQuality: "CHANGING",
    precallGateCooldownMinutes: 2,
    referenceWeightsKg: { child: 35, normal: 80, heavy: 110 },
    plannedBoardingMinutes: 8,
    plannedDeboardingMinutes: 5,
    plannedBufferMinutes: 3,
    departedVisibilitySeconds: 15,
  },
  gates: [
    {
      key: "gate-1",
      label: "Flight Line",
      gateType: "FLIGHT_LINE",
      active: true,
      sortOrder: 10,
      displayFilter: { productKeys: ["product-1"], rotationStatuses: [] },
    },
  ],
  resourceGroups: [
    {
      key: "group-1",
      name: "Standard",
      shortCode: "STD",
      gateKey: "gate-1",
      referenceCapacity: 3,
      compatibleAircraftTypes: ["C172"],
      automaticPrecallEnabled: true,
    },
  ],
  aircraft: [
    {
      key: "aircraft-1",
      registration: "D-EABC",
      aircraftType: "C172",
      passengerSeats: 3,
      maximumPassengerPayloadKg: null,
      refuelReminderThreshold: 5,
    },
  ],
  assignments: [{ aircraftKey: "aircraft-1", resourceGroupKey: "group-1" }],
  pilots: [
    {
      key: "pilot-1",
      operationalCode: "P-01",
      operationalNote: "",
      active: true,
    },
  ],
  products: [
    {
      key: "product-1",
      resourceGroupKey: "group-1",
      gateKey: "gate-1",
      name: "Standardflug",
      code: "STD-20",
      publicDescription: "",
      priceCents: 5000,
      referenceCapacity: 3,
      referenceDurationMinutes: 20,
      promisedFlightMinutes: 15,
      childCompanionRequired: false,
      weightClasses: ["NOT_CAPTURED"],
      sortOrder: 10,
      capacityWarningThreshold: 12,
      capacityCriticalThreshold: 4,
    },
  ],
} as const;

function validExport(): SimulationPlanExport {
  return simulationPlanExportSchema.parse({
    format: "rundflug-simulation-plan",
    formatVersion: 1,
    exportedAt: "2026-07-24T10:00:00.000Z",
    source: { name: "Rundflugtag", version: 4 },
    schedule: {
      timeZone: "Europe/Berlin",
      salesStartAt: "2026-07-24T07:00:00.000Z",
      salesEndAt: "2026-07-24T15:00:00.000Z",
      operationsStartAt: "2026-07-24T08:00:00.000Z",
      operationsEndAt: "2026-07-24T16:00:00.000Z",
    },
    masterData,
    plannedOperations: [
      {
        key: "plan-1",
        scopeType: "EVENT",
        scopeKey: "event",
        kind: "FLIGHT_SHOW",
        startMode: "TIME_WINDOW",
        earliestStartAt: "2026-07-24T11:00:00.000Z",
        latestStartAt: "2026-07-24T11:10:00.000Z",
        afterCurrentRotation: false,
        minimumDurationMinutes: 20,
        typicalDurationMinutes: 25,
        maximumDurationMinutes: 30,
        publicNote: "Flugshow",
      },
    ],
  });
}

describe("simulation plan export contract", () => {
  it("accepts the safe, versioned simulation basis", () => {
    const exported = validExport();
    expect(simulationPlanExportSchema.safeParse(exported).success).toBe(true);
    expect(exported.masterData.resourceGroups[0]).not.toHaveProperty("plannedRotationMinutes");
  });

  it("rejects dangling plan targets and operational state payloads", () => {
    const dangling = structuredClone(validExport());
    const firstDanglingPlan = dangling.plannedOperations[0];
    expect(firstDanglingPlan).toBeDefined();
    if (!firstDanglingPlan) return;
    dangling.plannedOperations[0] = {
      ...firstDanglingPlan,
      scopeType: "AIRCRAFT",
      scopeKey: "missing-aircraft",
      publicNote: "",
    };
    expect(simulationPlanExportSchema.safeParse(dangling).success).toBe(false);
    expect(
      simulationPlanExportSchema.safeParse({
        ...validExport(),
        tickets: [],
      }).success,
    ).toBe(false);
  });

  it("marks an after-rotation entry without exporting the operative rotation id", () => {
    const exported = structuredClone(validExport());
    const firstPlan = exported.plannedOperations[0];
    expect(firstPlan).toBeDefined();
    if (!firstPlan) return;
    exported.plannedOperations[0] = {
      ...firstPlan,
      startMode: "AFTER_CURRENT_ROTATION",
      earliestStartAt: null,
      latestStartAt: null,
      afterCurrentRotation: true,
    };
    expect(simulationPlanExportSchema.safeParse(exported).success).toBe(true);
    expect(exported.plannedOperations[0]).not.toHaveProperty("afterRotationId");
  });

  it("keeps V1 backward compatible and validates recurring rules in V2", () => {
    const legacy = validExport();
    expect(legacy.formatVersion).toBe(1);
    expect(legacy.recurringRules).toEqual([]);

    const versionTwo = {
      ...legacy,
      formatVersion: 2,
      recurringRules: [
        {
          key: "rule-1",
          scopeType: "AIRCRAFT",
          scopeKey: "aircraft-1",
          kind: "REFUELING",
          triggerMetric: "COMPLETED_ROTATIONS",
          intervalValue: 5,
          progressValue: 2,
          minimumDurationMinutes: 8,
          typicalDurationMinutes: 12,
          maximumDurationMinutes: 18,
        },
      ],
    };
    expect(simulationPlanExportSchema.safeParse(versionTwo).success).toBe(true);
    expect(
      simulationPlanExportSchema.safeParse({
        ...versionTwo,
        recurringRules: [{ ...versionTwo.recurringRules[0], scopeKey: "missing-aircraft" }],
      }).success,
    ).toBe(false);
    expect(
      simulationPlanExportSchema.safeParse({
        ...versionTwo,
        recurringRules: [
          {
            ...versionTwo.recurringRules[0],
            scopeType: "PILOT",
            scopeKey: "pilot-1",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
