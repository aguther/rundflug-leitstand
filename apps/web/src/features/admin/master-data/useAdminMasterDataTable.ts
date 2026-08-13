import type { OperationBoard } from "@rundflug/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MasterDataCategory } from "../../../admin-ux";

type SortDirection = "asc" | "desc" | null;
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

interface UseAdminMasterDataTableOptions {
  board: OperationBoard | null | undefined;
  category: MasterDataCategory;
}

const tableCollator = new Intl.Collator("de-DE", {
  numeric: true,
  sensitivity: "base",
});

function sortRows<T extends { id: string }>(
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

function nextSortDirection(direction: SortDirection): SortDirection {
  switch (direction) {
    case "asc":
      return "desc";
    case "desc":
      return null;
    default:
      return "asc";
  }
}

function gateSortValue(gate: Gate, key: string): string | number {
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

function resourceGroupSortValue(group: ResourceGroup, key: string): string | number {
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

function aircraftSortValue(aircraft: Aircraft, key: string): string | number {
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

function pilotSortValue(pilot: Pilot, key: string): string | number {
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

function productSortValue(product: Product, key: string): string | number {
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

function countForCategory(
  category: MasterDataCategory,
  counts: Readonly<Partial<Record<MasterDataCategory, CategoryCount>>>,
  fallback: CategoryCount,
): CategoryCount {
  return counts[category] ?? fallback;
}

export function useAdminMasterDataTable({ board, category }: UseAdminMasterDataTableOptions) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<AdminMasterDataSort>({
    category: "resource-groups",
    key: "name",
    direction: null,
  });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [resourceStatusFilter, setResourceStatusFilter] = useState("ALL");

  // biome-ignore lint/correctness/useExhaustiveDependencies: changing a filter or page size intentionally resets pagination
  useEffect(() => {
    setPage(0);
  }, [category, search, pageSize, resourceStatusFilter]);

  const toggleSort = useCallback(
    (key: string) => {
      setSort((current) => {
        if (current.category !== category || current.key !== key) {
          return { category, key, direction: "asc" };
        }
        return { ...current, direction: nextSortDirection(current.direction) };
      });
    },
    [category],
  );

  const rows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("de-DE");
    const resourceGroups = board?.resourceGroups ?? [];
    const alphabeticalProducts = (board?.products ?? []).toSorted(
      (left, right) =>
        tableCollator.compare(left.name, right.name) ||
        tableCollator.compare(left.code, right.code),
    );
    const visibleGates = sortRows(
      "gates",
      (board?.gates ?? []).filter((gate) =>
        `${gate.label} ${gate.gateType}`.toLocaleLowerCase("de-DE").includes(normalizedSearch),
      ),
      sort,
      gateSortValue,
    );
    const visibleResourceGroups = sortRows(
      "resource-groups",
      resourceGroups.filter(
        (group) =>
          (resourceStatusFilter === "ALL" || group.status === resourceStatusFilter) &&
          `${group.name} ${group.shortCode} ${group.gateLabel}`
            .toLocaleLowerCase("de-DE")
            .includes(normalizedSearch),
      ),
      sort,
      resourceGroupSortValue,
    );
    const visibleAircraft = sortRows(
      "aircraft",
      (board?.aircraft ?? []).filter((aircraft) =>
        `${aircraft.registration} ${aircraft.aircraftType} ${aircraft.resourceGroupName}`
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearch),
      ),
      sort,
      aircraftSortValue,
    );
    const visiblePilots = sortRows(
      "pilots",
      (board?.pilots ?? []).filter((pilot) =>
        `${pilot.operationalCode} ${pilot.operationalNote}`
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearch),
      ),
      sort,
      pilotSortValue,
    );
    const visibleProducts = sortRows(
      "products",
      alphabeticalProducts.filter((product) =>
        `${product.code} ${product.name} ${product.resourceGroupName} ${product.gateLabel}`
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearch),
      ),
      sort,
      productSortValue,
    );
    const productCounts = {
      filtered: visibleProducts.length,
      total: board?.products.length ?? 0,
    };
    const { filtered: filteredCount, total: totalCount } = countForCategory(
      category,
      {
        aircraft: {
          filtered: visibleAircraft.length,
          total: board?.aircraft.length ?? 0,
        },
        gates: { filtered: visibleGates.length, total: board?.gates.length ?? 0 },
        pilots: { filtered: visiblePilots.length, total: board?.pilots.length ?? 0 },
        products: productCounts,
        "resource-groups": {
          filtered: visibleResourceGroups.length,
          total: resourceGroups.length,
        },
      },
      productCounts,
    );
    const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));
    const clampedPage = Math.min(page, pageCount - 1);
    const pageStart = clampedPage * pageSize;
    const pageEnd = pageStart + pageSize;

    return {
      alphabeticalProducts,
      clampedPage,
      filteredCount,
      pagedAircraft: visibleAircraft.slice(pageStart, pageEnd),
      pagedGates: visibleGates.slice(pageStart, pageEnd),
      pagedPilots: visiblePilots.slice(pageStart, pageEnd),
      pagedProducts: visibleProducts.slice(pageStart, pageEnd),
      pagedResourceGroups: visibleResourceGroups.slice(pageStart, pageEnd),
      totalCount,
    };
  }, [board, category, page, pageSize, resourceStatusFilter, search, sort]);

  return {
    ...rows,
    pageSize,
    resourceStatusFilter,
    search,
    setPage,
    setPageSize,
    setResourceStatusFilter,
    setSearch,
    sort,
    toggleSort,
  };
}
