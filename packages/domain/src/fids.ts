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

const isUrgentFidsStatus = (status: string): boolean =>
  status === "BOARDING" || status === "COME_TO_FLIGHT_LINE";

export function partitionFidsRows<Row extends PageableFidsRow>(input: {
  rows: readonly Row[];
  visibleRows: number;
  priorityGroupCount: number;
  lowerPage: number;
}): FidsSplitProjection<Row> {
  const urgent = input.rows.filter((row) => isUrgentFidsStatus(row.status));
  const regularPrepare = input.rows.filter((row) => row.status === "PREPARE");
  const urgentShown = urgent.slice(0, input.visibleRows);
  const prepareCapacity = Math.max(0, input.priorityGroupCount - urgentShown.length);
  const priorityGroups = [
    ...urgentShown,
    ...regularPrepare.slice(0, Math.min(prepareCapacity, input.visibleRows - urgentShown.length)),
  ];
  const effectiveCapacity = Math.min(
    input.visibleRows,
    Math.max(input.priorityGroupCount, urgentShown.length),
  );
  const priorityIds = new Set(priorityGroups.map((row) => row.rowId));
  const remainingRows = input.rows.filter((row) => !priorityIds.has(row.rowId));
  const lowerPageSize = Math.max(0, input.visibleRows - effectiveCapacity);
  return {
    priority: {
      configuredCapacity: input.priorityGroupCount,
      effectiveCapacity,
      totalItems: urgent.length + priorityGroups.length - urgentShown.length,
      overflowCount: Math.max(0, urgent.length - input.visibleRows),
      groups: priorityGroups,
    },
    page: paginateFidsRows(remainingRows, input.lowerPage, lowerPageSize),
  };
}
