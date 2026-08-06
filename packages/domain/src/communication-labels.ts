function normalizedCode(code: string): string {
  return code.trim().toUpperCase();
}

export function formatBookingGroupLabel(productCode: string, communicationNumber: number): string {
  return `G-${normalizedCode(productCode)}-${String(communicationNumber).padStart(4, "0")}`;
}

export function formatBookingGroupPartLabel(
  productCode: string,
  communicationNumber: number,
  part: { partNumber: number; partCount: number },
): string {
  if (
    !Number.isInteger(part.partNumber) ||
    !Number.isInteger(part.partCount) ||
    part.partNumber < 1 ||
    part.partCount < 1 ||
    part.partNumber > part.partCount
  ) {
    throw new Error("Booking group part label requires positive, consistent integers.");
  }
  const bookingGroupLabel = formatBookingGroupLabel(productCode, communicationNumber);
  return part.partCount > 1 ? `${bookingGroupLabel}/${part.partNumber}` : bookingGroupLabel;
}

export function formatFlightGroupLabel(
  resourceGroupShortCode: string,
  communicationNumber: number,
): string {
  return `F-${normalizedCode(resourceGroupShortCode)}-${String(communicationNumber).padStart(3, "0")}`;
}
