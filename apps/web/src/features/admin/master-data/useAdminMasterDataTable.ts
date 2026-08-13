import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AdminMasterDataSort,
  aircraftSortValue,
  countForCategory,
  gateSortValue,
  nextSortDirection,
  pilotSortValue,
  productSortValue,
  resourceGroupSortValue,
  sortRows,
  tableCollator,
  type UseAdminMasterDataTableOptions,
} from "./admin-master-data-sorting";

export type { AdminMasterDataSort } from "./admin-master-data-sorting";

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
