export type ProductSalesEventStatus = "PREPARATION" | "ACTIVE" | "CLOSED" | "ARCHIVED";

export type ProductSalesPolicyError =
  | "PRODUCT_LIVE_SALES_NOT_AVAILABLE"
  | "PRODUCT_SALES_EVENT_READ_ONLY";

export function validateProductSalesUpdate(
  eventStatus: ProductSalesEventStatus,
  currentSaleEnabled: boolean,
  requestedSaleEnabled: boolean,
): ProductSalesPolicyError | null {
  if (eventStatus === "CLOSED" || eventStatus === "ARCHIVED") {
    return "PRODUCT_SALES_EVENT_READ_ONLY";
  }
  if (eventStatus === "PREPARATION" && currentSaleEnabled !== requestedSaleEnabled) {
    return "PRODUCT_LIVE_SALES_NOT_AVAILABLE";
  }
  return null;
}
