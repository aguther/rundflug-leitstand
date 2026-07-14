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
    ? compact.replace(/\./g, "").replace(",", ".")
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

export interface SortableProduct {
  id: string;
  name: string;
  sortOrder: number;
}

export function productPositionOptions(
  products: SortableProduct[],
  currentProductId: string,
): Array<{ value: number; label: string }> {
  const ordered = products.toSorted(
    (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
  );
  const current = ordered.find((product) => product.id === currentProductId);
  const currentIndex = ordered.findIndex((product) => product.id === currentProductId);
  const others = products
    .filter((product) => product.id !== currentProductId)
    .toSorted(
      (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    );
  if (others.length === 0) return [{ value: 10, label: "Einziges Produkt" }];
  return [
    { value: currentIndex === 0 && current ? current.sortOrder : 0, label: "Ganz vorne" },
    ...others.map((product, index) => {
      const nextSortOrder = others[index + 1]?.sortOrder ?? product.sortOrder + 20;
      return {
        value:
          current && currentIndex > 0 && ordered[currentIndex - 1]?.id === product.id
            ? current.sortOrder
            : index === others.length - 1
              ? product.sortOrder + 10
              : Math.max(0, Math.floor((product.sortOrder + nextSortOrder) / 2)),
        label: `Nach „${product.name}“`,
      };
    }),
  ];
}
