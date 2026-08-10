import type { OperationBoard } from "@rundflug/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MasterDataCategory } from "../../../admin-ux";

type SortDirection = "asc" | "desc" | null;

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
      setSort((current) =>
        current.category === category && current.key === key
          ? {
              ...current,
              direction:
                current.direction === "asc" ? "desc" : current.direction === "desc" ? null : "asc",
            }
          : { category, key, direction: "asc" },
      );
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
      (gate, key) =>
        key === "status"
          ? Number(gate.active)
          : key === "sortOrder"
            ? gate.sortOrder
            : key === "type"
              ? gate.gateType
              : gate.label,
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
      (group, key) =>
        key === "status"
          ? group.status
          : key === "gate"
            ? group.gateLabel
            : key === "capacity"
              ? group.referenceCapacity
              : key === "aircraft"
                ? group.activeAircraftIds.length
                : group.name,
    );
    const visibleAircraft = sortRows(
      "aircraft",
      (board?.aircraft ?? []).filter((aircraft) =>
        `${aircraft.registration} ${aircraft.aircraftType} ${aircraft.resourceGroupName}`
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearch),
      ),
      sort,
      (aircraft, key) =>
        key === "type"
          ? aircraft.aircraftType
          : key === "seats"
            ? aircraft.passengerSeats
            : key === "group"
              ? aircraft.resourceGroupName
              : key === "pilot"
                ? (aircraft.currentPilotOperationalCode ?? "")
                : key === "status"
                  ? aircraft.operationalState
                  : aircraft.registration,
    );
    const visiblePilots = sortRows(
      "pilots",
      (board?.pilots ?? []).filter((pilot) =>
        `${pilot.operationalCode} ${pilot.operationalNote}`
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearch),
      ),
      sort,
      (pilot, key) =>
        key === "note"
          ? pilot.operationalNote
          : key === "status"
            ? Number(pilot.active) + Number(pilot.paused)
            : key === "rotation"
              ? (pilot.currentCommunicationNumber ?? 0)
              : pilot.operationalCode,
    );
    const visibleProducts = sortRows(
      "products",
      alphabeticalProducts.filter((product) =>
        `${product.code} ${product.name} ${product.resourceGroupName} ${product.gateLabel}`
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearch),
      ),
      sort,
      (product, key) =>
        key === "name"
          ? product.name
          : key === "group"
            ? product.resourceGroupName
            : key === "gate"
              ? product.gateLabel
              : key === "price"
                ? product.priceCents
                : key === "duration"
                  ? product.referenceDurationMinutes
                  : key === "status"
                    ? Number(product.saleEnabled)
                    : product.code,
    );
    const filteredCount =
      category === "gates"
        ? visibleGates.length
        : category === "resource-groups"
          ? visibleResourceGroups.length
          : category === "aircraft"
            ? visibleAircraft.length
            : category === "pilots"
              ? visiblePilots.length
              : visibleProducts.length;
    const totalCount =
      category === "gates"
        ? (board?.gates.length ?? 0)
        : category === "resource-groups"
          ? resourceGroups.length
          : category === "aircraft"
            ? (board?.aircraft.length ?? 0)
            : category === "pilots"
              ? (board?.pilots.length ?? 0)
              : (board?.products.length ?? 0);
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
