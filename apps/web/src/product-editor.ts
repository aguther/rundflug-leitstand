export type ProductWeightClass = "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL";

export function formatEuroInput(priceCents: number): string {
  return `${(priceCents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

export function parseEuroToCents(value: string): number | null {
  const compact = value.trim().replace(/\s/g, "").replace(/€$/, "");
  const normalized = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(compact)
    ? compact.replaceAll(".", "").replace(",", ".")
    : compact.replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [euros, fraction = ""] = normalized.split(".");
  const cents = Number(euros) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function weightCaptureEnabled(weightClasses: string[]): boolean {
  return !weightClasses.includes("NOT_CAPTURED");
}

export function setWeightCaptureMode(enabled: boolean): ProductWeightClass[] {
  return enabled ? ["NORMAL"] : ["NOT_CAPTURED"];
}

export function toggleWeightClass(
  current: string[],
  weightClass: Exclude<ProductWeightClass, "NOT_CAPTURED">,
  checked: boolean,
): ProductWeightClass[] {
  const captured = current.filter(
    (entry): entry is Exclude<ProductWeightClass, "NOT_CAPTURED"> =>
      entry !== "NOT_CAPTURED" && ["CHILD", "NORMAL", "HEAVY", "INDIVIDUAL"].includes(entry),
  );
  return checked
    ? ([...new Set([...captured, weightClass])] as ProductWeightClass[])
    : captured.filter((entry) => entry !== weightClass);
}

export function weightClassesForChildCompanion(
  current: string[],
  enabled: boolean,
): ProductWeightClass[] {
  if (!enabled || current.includes("CHILD")) return current as ProductWeightClass[];
  return toggleWeightClass(current, "CHILD", true);
}
