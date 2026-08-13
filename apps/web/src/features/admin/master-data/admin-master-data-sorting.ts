import type { OperationBoard } from "@rundflug/contracts";
import type { MasterDataCategory } from "../../../admin-ux";

export type SortDirection = "asc" | "desc" | null;
type Gate = OperationBoard["gates"][number];
type ResourceGroup = OperationBoard["resourceGroups"][number];
type Aircraft = OperationBoard["aircraft"][number];
type Pilot = OperationBoard["pilots"][number];
type Product = OperationBoard["products"][number];

interface CategoryCount {
  filtered: number;
  total: number;
}

export interface AdminMasterDataSort {
  category: MasterDataCategory;
  key: string;
  direction: SortDirection;
}

export interface UseAdminMasterDataTableOptions {
  board: OperationBoard | null | undefined;
  category: MasterDataCategory;
}

export const tableCollator = new Intl.Collator("de-DE", {
  numeric: true,
  sensitivity: "base",
});

export function sortRows<T extends { id: string }>(
  category: MasterDataCategory,
  rows: readonly T[],
  sort: AdminMasterDataSort,
  valueFor: (row: T, key: string) => string | number,
): T[] {
  if (sort.category !== category || sort.direction === null) return [...rows];
  return rows.toSorted((left, right) => {
    const leftValue = valueFor(left, sort.key);
    const rightValue = valueFor(right, sort.key);
    const comparison =
      typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : tableCollator.compare(String(leftValue), String(rightValue));
    return sort.direction === "asc" ? comparison : -comparison;
  });
}

export function nextSortDirection(direction: SortDirection): SortDirection {
  switch (direction) {
    case "asc":
      return "desc";
    case "desc":
      return null;
    default:
      return "asc";
  }
}

export function gateSortValue(gate: Gate, key: string): string | number {
  switch (key) {
    case "status":
      return Number(gate.active);
    case "sortOrder":
      return gate.sortOrder;
    case "type":
      return gate.gateType;
    default:
      return gate.label;
  }
}

export function resourceGroupSortValue(group: ResourceGroup, key: string): string | number {
  switch (key) {
    case "status":
      return group.status;
    case "gate":
      return group.gateLabel;
    case "capacity":
      return group.referenceCapacity;
    case "aircraft":
      return group.activeAircraftIds.length;
    default:
      return group.name;
  }
}

export function aircraftSortValue(aircraft: Aircraft, key: string): string | number {
  switch (key) {
    case "type":
      return aircraft.aircraftType;
    case "seats":
      return aircraft.passengerSeats;
    case "group":
      return aircraft.resourceGroupName;
    case "pilot":
      return aircraft.currentPilotOperationalCode ?? "";
    case "status":
      return aircraft.operationalState;
    default:
      return aircraft.registration;
  }
}

export function pilotSortValue(pilot: Pilot, key: string): string | number {
  switch (key) {
    case "note":
      return pilot.operationalNote;
    case "status":
      return Number(pilot.active) + Number(pilot.paused);
    case "rotation":
      return pilot.currentCommunicationNumber ?? 0;
    default:
      return pilot.operationalCode;
  }
}

export function productSortValue(product: Product, key: string): string | number {
  switch (key) {
    case "name":
      return product.name;
    case "group":
      return product.resourceGroupName;
    case "gate":
      return product.gateLabel;
    case "price":
      return product.priceCents;
    case "duration":
      return product.referenceDurationMinutes;
    case "status":
      return Number(product.saleEnabled);
    default:
      return product.code;
  }
}

export function countForCategory(
  category: MasterDataCategory,
  counts: Readonly<Partial<Record<MasterDataCategory, CategoryCount>>>,
  fallback: CategoryCount,
): CategoryCount {
  return counts[category] ?? fallback;
}
