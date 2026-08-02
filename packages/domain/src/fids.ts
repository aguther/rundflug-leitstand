export const FIDS_PAGE_LIMIT = 999;

export function parseFidsPage(value: string | null | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= FIDS_PAGE_LIMIT ? page : 1;
}

export interface FidsContentFilterInput {
  productIds: readonly string[];
  gateIds: readonly string[];
}

export interface FilterableFidsRow {
  rowId: string;
  productId: string;
  gateId: string | null;
}

export function filterFidsRows<Row extends FilterableFidsRow>(
  rows: readonly Row[],
  filter: FidsContentFilterInput,
): Row[] {
  const productIds = new Set(filter.productIds);
  const gateIds = new Set(filter.gateIds);
  return rows.filter(
    (row) =>
      (productIds.size === 0 || productIds.has(row.productId)) &&
      (gateIds.size === 0 || (row.gateId !== null && gateIds.has(row.gateId))),
  );
}

export interface PageableFidsRow extends FilterableFidsRow {
  departedAt?: string | null;
  status: string;
}

export interface FidsPage<Row> {
  requestedPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  groups: Row[];
}

export function paginateFidsRows<Row>(
  rows: readonly Row[],
  requestedPage: number,
  pageSize: number,
): FidsPage<Row> {
  const totalPages = pageSize === 0 ? 0 : Math.ceil(rows.length / pageSize);
  const start = pageSize === 0 ? 0 : (requestedPage - 1) * pageSize;
  return {
    requestedPage,
    pageSize,
    totalItems: rows.length,
    totalPages,
    groups: pageSize === 0 ? [] : rows.slice(start, start + pageSize),
  };
}

export interface FidsSplitProjection<Row> {
  priority: {
    configuredCapacity: number;
    effectiveCapacity: number;
    totalItems: number;
    overflowCount: number;
    groups: Row[];
  };
  page: FidsPage<Row>;
}

const isActionableFidsStatus = (status: string): boolean =>
  status === "BOARDING" || status === "COME_TO_FLIGHT_LINE";

const isRecentDepartureFidsStatus = (status: string): boolean =>
  status === "IN_FLIGHT" || status === "LANDED" || status === "COMPLETED";

export interface FidsSplitCapacityPlan {
  actionableLimit: number;
  recentDepartureLimit: number;
  prepareLimit: number;
  effectivePriorityCapacity: number;
  lowerPageSize: number;
  overflowCount: number;
}

export function planFidsSplitCapacity(input: {
  visibleRows: number;
  priorityGroupCount: number;
  actionableCount: number;
  recentDepartureCount: number;
}): FidsSplitCapacityPlan {
  const visibleRows = Math.max(0, Math.floor(input.visibleRows));
  const configuredPriorityCapacity = Math.min(
    visibleRows,
    Math.max(0, Math.floor(input.priorityGroupCount)),
  );
  const actionableCount = Math.max(0, Math.floor(input.actionableCount));
  const recentDepartureCount = Math.max(0, Math.floor(input.recentDepartureCount));
  const actionableLimit = Math.min(actionableCount, visibleRows);
  const recentDepartureLimit = Math.min(
    recentDepartureCount,
    Math.max(0, visibleRows - actionableLimit),
  );
  const mandatoryVisibleCount = actionableLimit + recentDepartureLimit;
  const effectivePriorityCapacity = Math.min(
    visibleRows,
    Math.max(configuredPriorityCapacity, mandatoryVisibleCount),
  );

  return {
    actionableLimit,
    recentDepartureLimit,
    prepareLimit: Math.max(0, configuredPriorityCapacity - mandatoryVisibleCount),
    effectivePriorityCapacity,
    lowerPageSize: Math.max(0, visibleRows - effectivePriorityCapacity),
    overflowCount: Math.max(0, actionableCount + recentDepartureCount - mandatoryVisibleCount),
  };
}

export function partitionFidsRows<Row extends PageableFidsRow>(input: {
  rows: readonly Row[];
  visibleRows: number;
  priorityGroupCount: number;
  lowerPage: number;
}): FidsSplitProjection<Row> {
  const actionable = input.rows.filter((row) => isActionableFidsStatus(row.status));
  const recentDepartures = input.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => isRecentDepartureFidsStatus(row.status))
    .sort((left, right) => {
      const departedDifference =
        Date.parse(right.row.departedAt ?? "") - Date.parse(left.row.departedAt ?? "");
      return (
        (Number.isFinite(departedDifference) ? departedDifference : 0) || left.index - right.index
      );
    })
    .map(({ row }) => row);
  const prepare = input.rows.filter((row) => row.status === "PREPARE");
  const capacity = planFidsSplitCapacity({
    visibleRows: input.visibleRows,
    priorityGroupCount: input.priorityGroupCount,
    actionableCount: actionable.length,
    recentDepartureCount: recentDepartures.length,
  });
  const actionableShown = actionable.slice(0, capacity.actionableLimit);
  const recentDeparturesShown = recentDepartures.slice(0, capacity.recentDepartureLimit);
  const prepareShown = prepare.slice(0, capacity.prepareLimit);
  const priorityGroups = [...actionableShown, ...recentDeparturesShown, ...prepareShown];
  const mandatoryPriorityIds = new Set(
    [...actionable, ...recentDepartures].map((row) => row.rowId),
  );
  const selectedPrepareIds = new Set(prepareShown.map((row) => row.rowId));
  const remainingRows = input.rows.filter(
    (row) => !mandatoryPriorityIds.has(row.rowId) && !selectedPrepareIds.has(row.rowId),
  );
  return {
    priority: {
      configuredCapacity: input.priorityGroupCount,
      effectiveCapacity: capacity.effectivePriorityCapacity,
      totalItems: actionable.length + recentDepartures.length + prepareShown.length,
      overflowCount: capacity.overflowCount,
      groups: priorityGroups,
    },
    page: paginateFidsRows(remainingRows, input.lowerPage, capacity.lowerPageSize),
  };
}
