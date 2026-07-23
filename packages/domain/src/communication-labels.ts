function normalizedCode(code: string): string {
  return code.trim().toUpperCase();
}

export function formatBookingGroupLabel(productCode: string, communicationNumber: number): string {
  return `G-${normalizedCode(productCode)}-${String(communicationNumber).padStart(4, "0")}`;
}

export function formatFlightGroupLabel(
  resourceGroupShortCode: string,
  communicationNumber: number,
): string {
  return `F-${normalizedCode(resourceGroupShortCode)}-${String(communicationNumber).padStart(3, "0")}`;
}
