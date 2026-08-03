import { formatBookingGroupLabel } from "./communication-labels";

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

export interface SharedFlightFidsRow extends PageableFidsRow {
  activeRecall?: unknown | null;
  bookingGroupLabels?: readonly string[] | undefined;
  communicationNumber: number;
  productCode: string;
  sharedFlightKey?: string | null | undefined;
  ticketLabels: readonly string[];
}

const isActionableFidsStatus = (status: string): boolean =>
  status === "BOARDING" || status === "COME_TO_FLIGHT_LINE";

const isRecentDepartureFidsStatus = (status: string): boolean =>
  status === "IN_FLIGHT" || status === "LANDED" || status === "COMPLETED";

export function orderFidsRows<Row extends PageableFidsRow>(rows: readonly Row[]): Row[] {
  const actionable = rows.filter((row) => isActionableFidsStatus(row.status));
  const recentDepartures = rows
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
  const prepare = rows.filter((row) => row.status === "PREPARE");
  const remaining = rows.filter(
    (row) =>
      !isActionableFidsStatus(row.status) &&
      !isRecentDepartureFidsStatus(row.status) &&
      row.status !== "PREPARE",
  );
  return [...actionable, ...recentDepartures, ...prepare, ...remaining];
}

function stableFidsRowHash(value: string): string {
  let forward = 0x811c9dc5;
  let backward = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    forward = Math.imul(forward ^ value.charCodeAt(index), 0x01000193);
    backward = Math.imul(backward ^ value.charCodeAt(value.length - index - 1), 0x01000193);
  }
  return `${(forward >>> 0).toString(36)}${(backward >>> 0).toString(36)}`;
}

function bookingGroupLabels(row: SharedFlightFidsRow): string[] {
  return row.bookingGroupLabels && row.bookingGroupLabels.length > 0
    ? [...row.bookingGroupLabels]
    : [formatBookingGroupLabel(row.productCode, row.communicationNumber)];
}

export function groupSharedFidsFlights<Row extends SharedFlightFidsRow>(
  rows: readonly Row[],
  enabled: boolean,
): Row[] {
  if (!enabled) return [...rows];

  const grouped = new Map<string, Row[]>();
  const orderedKeys: string[] = [];
  for (const row of rows) {
    const canGroup = row.activeRecall == null && Boolean(row.sharedFlightKey);
    const key = canGroup
      ? [row.sharedFlightKey, row.productId, row.gateId ?? "", row.status].join("\u001f")
      : `row:${row.rowId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(key, [row]);
      orderedKeys.push(key);
    }
  }

  return orderedKeys.flatMap((key) => {
    const members = grouped.get(key) ?? [];
    if (members.length === 0 || key.startsWith("row:")) return members;
    const chunks: Row[] = [];
    for (let offset = 0; offset < members.length; offset += 3) {
      const chunk = members.slice(offset, offset + 3);
      const first = chunk[0];
      if (!first) continue;
      const labels = Array.from(new Set(chunk.flatMap(bookingGroupLabels))).slice(0, 3);
      chunks.push({
        ...first,
        rowId: `fids-shared-${stableFidsRowHash(`${key}:${Math.floor(offset / 3)}`)}`,
        bookingGroupLabels: labels,
        ticketLabels: chunk.flatMap((row) => [...row.ticketLabels]),
      });
    }
    return chunks;
  });
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
