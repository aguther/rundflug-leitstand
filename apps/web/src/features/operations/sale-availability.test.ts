import type { OperationBoard } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import { eventSaleBlockReason, productSaleBlockReason } from "./sale-availability";

const nowMs = Date.parse("2026-08-19T10:00:00.000Z");
const event = {
  emergencyMode: false,
  operationalInterrupted: false,
  saleOpensAt: null,
  status: "ACTIVE",
} as OperationBoard["event"];
const product = {
  resourceGroupStatus: "ACTIVE",
  saleClosesAt: null,
  saleEnabled: true,
} as OperationBoard["products"][number];

describe("effective sale availability", () => {
  it("prioritizes the event lifecycle before other sale guards", () => {
    expect(
      eventSaleBlockReason({ ...event, emergencyMode: true, status: "CLOSED" }, nowMs),
    ).toEqual({ code: "EVENT_CLOSED", label: "Betrieb geschlossen" });
    expect(eventSaleBlockReason({ ...event, status: "PREPARATION" }, nowMs)?.label).toBe(
      "Betrieb nicht freigegeben",
    );
    expect(eventSaleBlockReason({ ...event, status: "ARCHIVED" }, nowMs)?.label).toBe(
      "Veranstaltung archiviert",
    );
  });

  it("covers event, product, resource-group and configured time guards", () => {
    expect(eventSaleBlockReason({ ...event, emergencyMode: true }, nowMs)?.code).toBe(
      "EMERGENCY_MODE",
    );
    expect(eventSaleBlockReason({ ...event, operationalInterrupted: true }, nowMs)?.code).toBe(
      "OPERATION_INTERRUPTED",
    );
    expect(
      eventSaleBlockReason({ ...event, saleOpensAt: "2026-08-19T10:01:00.000Z" }, nowMs)?.code,
    ).toBe("SALE_NOT_OPEN");
    expect(productSaleBlockReason(event, { ...product, saleEnabled: false }, nowMs)?.code).toBe(
      "PRODUCT_DISABLED",
    );
    expect(
      productSaleBlockReason(event, { ...product, resourceGroupStatus: "PAUSED" }, nowMs)?.code,
    ).toBe("RESOURCE_GROUP_INACTIVE");
    expect(
      productSaleBlockReason(event, { ...product, saleClosesAt: "2026-08-19T09:59:00.000Z" }, nowMs)
        ?.code,
    ).toBe("SALE_CLOSED");
    expect(productSaleBlockReason(event, product, nowMs)).toBeNull();
  });
});
