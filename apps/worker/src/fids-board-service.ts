import type { FidsBoardResponse } from "@rundflug/contracts";
import {
  groupSharedFidsFlights,
  orderFidsRows,
  paginateFidsRows,
  parseFidsPage,
  partitionFidsRows,
} from "@rundflug/domain";
import {
  type FidsProjectionFilter,
  loadAllFidsProjectionRows,
  loadFidsProjectionEvent,
  loadFidsProjectionFleet,
} from "./fids-board-projection";
import { mapFidsProjectionRow } from "./fids-board-response";
import { loadFidsPreferences } from "./fids-preferences-storage";

const defaultDependencies = {
  groupSharedFidsFlights,
  loadAllFidsProjectionRows,
  loadFidsPreferences,
  loadFidsProjectionEvent,
  loadFidsProjectionFleet,
  mapFidsProjectionRow,
  now: () => new Date(),
  orderFidsRows,
  paginateFidsRows,
  parseFidsPage,
  partitionFidsRows,
};

export type FidsBoardServiceDependencies = typeof defaultDependencies;

export async function buildProtectedFidsBoard(
  database: D1Database,
  input: {
    eventId: string;
    accountId: string;
    page: string | undefined;
    lowerPage: string | undefined;
  },
  dependencies: FidsBoardServiceDependencies = defaultDependencies,
): Promise<FidsBoardResponse | null> {
  const event = await dependencies.loadFidsProjectionEvent(database, input.eventId);
  if (!event) return null;

  const preferences = await dependencies.loadFidsPreferences(
    database,
    input.accountId,
    input.eventId,
  );
  const page = dependencies.parseFidsPage(input.page);
  const lowerPage = dependencies.parseFidsPage(input.lowerPage);
  const boardReadAt = dependencies.now().toISOString();
  const departedVisibilityCutoff = new Date(
    dependencies.now().getTime() - event.departed_visibility_seconds * 1_000,
  ).toISOString();
  const filter: FidsProjectionFilter = {
    productIds: preferences.contentFilter.productIds,
    gateIds: preferences.contentFilter.gateIds,
    rotationStatuses: [],
  };
  const baseProjection = {
    eventId: input.eventId,
    filter,
    departedVisibilityCutoff,
    now: boardReadAt,
  };
  const [fleet, projectionRows] =
    event.emergency_mode === 1
      ? [[], []]
      : await Promise.all([
          dependencies.loadFidsProjectionFleet(database, input.eventId),
          dependencies.loadAllFidsProjectionRows(database, { ...baseProjection, band: "ALL" }),
        ]);
  const displayedRows = dependencies.groupSharedFidsFlights(
    dependencies.orderFidsRows(
      projectionRows.map((row) => dependencies.mapFidsProjectionRow(row, event, boardReadAt)),
    ),
    preferences.groupSharedFlights,
  );

  let priority: FidsBoardResponse["priority"] = null;
  let boardPage: FidsBoardResponse["page"];
  if (event.emergency_mode === 1) {
    boardPage = {
      requestedPage: preferences.viewMode === "SPLIT" ? lowerPage : page,
      pageSize:
        preferences.viewMode === "SPLIT"
          ? preferences.visibleRows - preferences.priorityGroupCount
          : preferences.visibleRows,
      totalItems: 0,
      totalPages: 0,
      groups: [],
    };
    if (preferences.viewMode === "SPLIT") {
      priority = {
        configuredCapacity: preferences.priorityGroupCount,
        effectiveCapacity: preferences.priorityGroupCount,
        totalItems: 0,
        overflowCount: 0,
        groups: [],
      };
    }
  } else if (preferences.viewMode === "FIXED_PAGE") {
    boardPage = dependencies.paginateFidsRows(displayedRows, page, preferences.visibleRows);
  } else {
    const splitProjection = dependencies.partitionFidsRows({
      rows: displayedRows,
      visibleRows: preferences.visibleRows,
      priorityGroupCount: preferences.priorityGroupCount,
      lowerPage,
    });
    priority = splitProjection.priority;
    boardPage = splitProjection.page;
  }

  return {
    eventName: event.name,
    timeZone: event.time_zone,
    emergencyMode: event.emergency_mode === 1,
    operationalInterrupted: event.operational_interrupted === 1,
    operationalNotice: event.planned_public_note || event.operational_note,
    departedVisibilitySeconds: event.departed_visibility_seconds,
    updatedAt: event.updated_at,
    preferencesVersion: preferences.version,
    viewMode: preferences.viewMode,
    filterSummary: preferences.contentFilter,
    priority,
    page: boardPage,
    fleet: event.emergency_mode
      ? []
      : fleet.map((aircraft) => ({
          registration: aircraft.registration,
          status: aircraft.operational_state as FidsBoardResponse["fleet"][number]["status"],
          refuelPlanned: aircraft.refuel_planned === 1,
        })),
  };
}
