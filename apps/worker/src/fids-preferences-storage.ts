import {
  type FidsContentFilter,
  type FidsPreferences,
  fidsContentFilterSchema,
} from "@rundflug/contracts";

export const DEFAULT_FIDS_PREFERENCES: FidsPreferences = {
  visibleRows: 8,
  layout: "SINGLE",
  theme: "SYSTEM",
  viewMode: "FIXED_PAGE",
  priorityGroupCount: 3,
  rotationIntervalSeconds: 12,
  contentFilter: { productIds: [], gateIds: [] },
  version: 0,
};

export interface StoredFidsPreferences {
  visible_rows: number;
  layout: FidsPreferences["layout"];
  theme: FidsPreferences["theme"];
  view_mode: FidsPreferences["viewMode"];
  priority_group_count: number;
  rotation_interval_seconds: number;
  content_filter_json: string;
  version: number;
}

export function normalizeFidsContentFilter(filter: FidsContentFilter): FidsContentFilter {
  return {
    productIds: [...filter.productIds].sort((left, right) => left.localeCompare(right)),
    gateIds: [...filter.gateIds].sort((left, right) => left.localeCompare(right)),
  };
}

export function storedFidsPreferences(row: StoredFidsPreferences | null): FidsPreferences {
  if (!row) return DEFAULT_FIDS_PREFERENCES;
  return {
    visibleRows: row.visible_rows,
    layout: row.layout,
    theme: row.theme,
    viewMode: row.view_mode,
    priorityGroupCount: row.priority_group_count,
    rotationIntervalSeconds: row.rotation_interval_seconds,
    contentFilter: normalizeFidsContentFilter(
      fidsContentFilterSchema.parse(JSON.parse(row.content_filter_json)),
    ),
    version: row.version,
  };
}

export async function loadFidsPreferences(
  db: D1Database,
  accountId: string,
  eventId: string,
): Promise<FidsPreferences> {
  const row = await db
    .prepare(
      `SELECT visible_rows, layout, theme, view_mode, priority_group_count,
              rotation_interval_seconds, content_filter_json, version
         FROM fids_preferences
        WHERE operator_account_id = ?1 AND operation_day_id = ?2`,
    )
    .bind(accountId, eventId)
    .first<StoredFidsPreferences>();
  return storedFidsPreferences(row);
}
