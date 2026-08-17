export type Env = Omit<
  CloudflareBindings,
  | "APP_ENV"
  | "DATA_JURISDICTION"
  | "ADMIN_PIN_HASH"
  | "BOOTSTRAP_TOKEN"
  | "INSTALLATION_RECOVERY_CODE"
  | "RESET_SETUP_SIGNING_KEY"
  | "DEPLOYMENT_BACKUP_TOKEN_HASH"
  | "VAPID_PUBLIC_KEY"
  | "VAPID_PRIVATE_KEY"
  | "VAPID_SUBJECT"
  | "PUSH_RETENTION_DAYS"
  | "SOURCE_REVISION"
  | "ANALYSIS_RETENTION_DAYS"
  | "PLANNING_DETAIL_RETENTION_HOURS"
  | "PLANNING_HISTORY_RETENTION_YEARS"
> & {
  APP_ENV: "development" | "acceptance" | "production";
  DATA_JURISDICTION: "eu";
  /** @deprecated Only read by the V1.1 compatibility routes during the V1.2 transition. */
  ADMIN_PIN_HASH?: string;
  INSTALLATION_RECOVERY_CODE?: string;
  RESET_SETUP_SIGNING_KEY?: string;
  DEPLOYMENT_BACKUP_TOKEN_HASH?: string;
  /** @deprecated Use INSTALLATION_RECOVERY_CODE. Kept for one deployment transition. */
  BOOTSTRAP_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  PUSH_RETENTION_DAYS?: string;
  SOURCE_REVISION?: string;
  ANALYSIS_RETENTION_DAYS?: string;
  PLANNING_DETAIL_RETENTION_HOURS?: string;
  PLANNING_HISTORY_RETENTION_YEARS?: string;
};

export interface StoredEventRow {
  id: string;
  name: string;
  event_date: string;
  aerodrome?: string;
  time_zone: string;
  status: "PREPARATION" | "ACTIVE" | "CLOSED" | "ARCHIVED";
  archived_at?: string | null;
  template_source_id?: string | null;
  emergency_mode: number;
  operational_interrupted?: number;
  version: number;
  operational_note: string;
  operations_start_at?: string | null;
  operations_end_at?: string | null;
  sale_opens_at?: string | null;
  no_show_after_minutes?: number;
  max_ticket_deferrals?: number;
  notification_lead_minutes?: number;
  automatic_precall_enabled?: number;
  precall_lead_minutes?: number;
  max_gate_wait_minutes?: number;
  precall_min_quality?: "STABLE" | "CHANGING";
  precall_gate_cooldown_minutes?: number;
  child_reference_weight_kg?: number;
  normal_reference_weight_kg?: number;
  heavy_reference_weight_kg?: number;
  planned_boarding_minutes?: number;
  planned_deboarding_minutes?: number;
  planned_buffer_minutes?: number;
  departed_visibility_seconds?: number;
  logo_object_key?: string | null;
  logo_dark_object_key?: string | null;
  updated_at: string;
}
