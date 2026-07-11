export interface Env {
  APP_ENV: "development" | "acceptance" | "production";
  DATA_JURISDICTION: "eu";
  DB: D1Database;
  BACKUPS: R2Bucket;
  EVENT_COORDINATOR: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export interface StoredEventRow {
  id: string;
  name: string;
  event_date: string;
  time_zone: string;
  status: string;
  emergency_mode: number;
  version: number;
  operational_note: string;
  updated_at: string;
}
