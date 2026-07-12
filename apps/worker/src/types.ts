export interface Env {
  APP_ENV: "development" | "acceptance" | "production";
  DATA_JURISDICTION: "eu";
  ADMIN_PIN_HASH: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  PUSH_RETENTION_DAYS?: string;
  DB: D1Database;
  BACKUPS: R2Bucket;
  PUBLIC_TICKET_RATE_LIMITER: RateLimit;
  EVENT_COORDINATOR: DurableObjectNamespace;
  ASSETS: Fetcher;
}

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
  operations_end_at?: string | null;
  sale_opens_at?: string | null;
  no_show_after_minutes?: number;
  notification_lead_minutes?: number;
  child_reference_weight_kg?: number;
  normal_reference_weight_kg?: number;
  heavy_reference_weight_kg?: number;
  planned_boarding_minutes?: number;
  planned_deboarding_minutes?: number;
  planned_buffer_minutes?: number;
  updated_at: string;
}
