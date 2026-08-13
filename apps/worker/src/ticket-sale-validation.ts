import { assertSaleAllowed, DomainRuleError, planBookingGroupSplit } from "@rundflug/domain";
import type { StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export function ticketSaleJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export type SaleProduct = {
  id: string;
  code: string;
  name: string;
  resource_group_id: string;
  gate_id: string;
  gate_label: string;
  price_cents: number;
  sale_enabled: number;
  sale_closes_at: string | null;
  weight_classes_json: string;
  resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
  effective_group_capacity: number;
};

export function salePrerequisiteError(
  product: SaleProduct,
  current: StoredEventRow,
): Response | null {
  if (!product.gate_id) {
    return ticketSaleJson(
      {
        error: {
          code: "PRODUCT_GATE_REQUIRED",
          message: "Für das Produkt muss vor dem Verkauf ein Gate konfiguriert sein.",
        },
      },
      { status: 409 },
    );
  }
  if (current.sale_opens_at && Date.parse(current.sale_opens_at) > Date.now()) {
    return ticketSaleJson(
      {
        error: {
          code: "SALE_NOT_OPEN",
          message: "Der konfigurierte Verkaufsbeginn ist noch nicht erreicht.",
        },
      },
      { status: 409 },
    );
  }
  if (!current.operations_end_at) {
    return ticketSaleJson(
      {
        error: {
          code: "OPERATING_END_REQUIRED",
          message: "Betriebsende muss vor dem Verkauf konfiguriert sein.",
        },
      },
      { status: 409 },
    );
  }
  if (product.effective_group_capacity === 0) {
    return ticketSaleJson(
      {
        error: {
          code: "SALE_BLOCKED_NO_AIRCRAFT",
          message: "Der Ressourcengruppe ist kein aktives Flugzeug zugeordnet.",
        },
      },
      { status: 409 },
    );
  }
  return null;
}

export function invalidTicketDetails(
  ticketDetails: ReadonlyArray<{
    weightClass: "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL";
    individualWeightKg: number | null;
  }>,
  allowedWeightClasses: ReadonlyArray<string>,
): boolean {
  return ticketDetails.some(
    (detail) =>
      !allowedWeightClasses.includes(detail.weightClass) ||
      (detail.weightClass === "INDIVIDUAL" && detail.individualWeightKg === null) ||
      (detail.weightClass !== "INDIVIDUAL" && detail.individualWeightKg !== null),
  );
}

export function saleRuleError(product: SaleProduct, current: StoredEventRow): Response | null {
  try {
    assertSaleAllowed({
      eventStatus: current.status,
      productSaleEnabled: product.sale_enabled === 1,
      resourceGroupStatus: product.resource_group_status,
      emergencyMode: current.emergency_mode === 1,
      eventInterrupted: current.operational_interrupted === 1,
      saleClosingReached:
        product.sale_closes_at !== null && Date.parse(product.sale_closes_at) <= Date.now(),
    });
    return null;
  } catch (reason: unknown) {
    if (reason instanceof DomainRuleError) {
      return ticketSaleJson(
        { error: { code: reason.code, message: reason.message } },
        { status: 409 },
      );
    }
    throw reason;
  }
}

export function bookingSplitResult(input: {
  groupSize: number;
  referenceCapacity: number;
  splitAcknowledged: boolean;
}):
  | { plan: ReturnType<typeof planBookingGroupSplit>; error: null }
  | { plan: null; error: Response } {
  try {
    return { plan: planBookingGroupSplit(input), error: null };
  } catch (reason: unknown) {
    if (reason instanceof DomainRuleError) {
      return {
        plan: null,
        error: ticketSaleJson(
          { error: { code: reason.code, message: reason.message } },
          { status: 409 },
        ),
      };
    }
    throw reason;
  }
}
