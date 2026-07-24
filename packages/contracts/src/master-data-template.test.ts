import { describe, expect, it } from "vitest";
import { masterDataTemplateSchema } from "./index";

const validTemplate = {
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
      plannedRotationMinutes: 20,
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
  pilots: [{ key: "pilot-1", operationalCode: "P-01", operationalNote: "", active: true }],
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

describe("master data template contract", () => {
  it("accepts the versioned, reference-safe format", () => {
    expect(masterDataTemplateSchema.safeParse(validTemplate).success).toBe(true);
  });

  it("rejects unknown operational or account data", () => {
    expect(
      masterDataTemplateSchema.safeParse({ ...validTemplate, operatorAccounts: [] }).success,
    ).toBe(false);
  });

  it("rejects duplicate and dangling references", () => {
    const invalid = structuredClone(masterDataTemplateSchema.parse(validTemplate));
    const firstProduct = invalid.products[0];
    expect(firstProduct).toBeDefined();
    if (!firstProduct) return;
    firstProduct.gateKey = "missing-gate";
    invalid.assignments.push({ aircraftKey: "aircraft-1", resourceGroupKey: "group-1" });
    const result = masterDataTemplateSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(" ")).toMatch(
        /Gate-Verweis|Flugzeugzuordnung/,
      );
    }
  });
});
