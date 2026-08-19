import type { OperationBoard } from "@rundflug/contracts";

type Event = OperationBoard["event"];
type Product = OperationBoard["products"][number];

export type SaleBlockReason = {
  code:
    | "EVENT_PREPARATION"
    | "EVENT_CLOSED"
    | "EVENT_ARCHIVED"
    | "EMERGENCY_MODE"
    | "OPERATION_INTERRUPTED"
    | "SALE_NOT_OPEN"
    | "PRODUCT_DISABLED"
    | "RESOURCE_GROUP_INACTIVE"
    | "SALE_CLOSED";
  label: string;
};

function hasReached(value: string | null, nowMs: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= nowMs;
}

function isUpcoming(value: string | null, nowMs: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > nowMs;
}

export function eventSaleBlockReason(event: Event, nowMs = Date.now()): SaleBlockReason | null {
  if (event.status === "PREPARATION") {
    return { code: "EVENT_PREPARATION", label: "Betrieb nicht freigegeben" };
  }
  if (event.status === "CLOSED") {
    return { code: "EVENT_CLOSED", label: "Betrieb geschlossen" };
  }
  if (event.status === "ARCHIVED") {
    return { code: "EVENT_ARCHIVED", label: "Veranstaltung archiviert" };
  }
  if (event.emergencyMode) {
    return { code: "EMERGENCY_MODE", label: "Not-Halt aktiv" };
  }
  if (event.operationalInterrupted) {
    return { code: "OPERATION_INTERRUPTED", label: "Betrieb unterbrochen" };
  }
  if (isUpcoming(event.saleOpensAt, nowMs)) {
    return { code: "SALE_NOT_OPEN", label: "Verkauf noch nicht geöffnet" };
  }
  return null;
}

export function productSaleBlockReason(
  event: Event,
  product: Product,
  nowMs = Date.now(),
): SaleBlockReason | null {
  const eventReason = eventSaleBlockReason(event, nowMs);
  if (eventReason) return eventReason;
  if (!product.saleEnabled) {
    return { code: "PRODUCT_DISABLED", label: "Produktverkauf gesperrt" };
  }
  if (product.resourceGroupStatus !== "ACTIVE") {
    return { code: "RESOURCE_GROUP_INACTIVE", label: "Ressourcengruppe nicht aktiv" };
  }
  if (hasReached(product.saleClosesAt, nowMs)) {
    return { code: "SALE_CLOSED", label: "Verkaufsschluss erreicht" };
  }
  return null;
}
