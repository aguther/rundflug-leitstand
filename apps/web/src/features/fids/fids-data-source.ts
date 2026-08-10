import type { FidsBoardResponse, FidsFilterOptions, FidsPreferences } from "@rundflug/contracts";

export type EditableFidsPreferences = Omit<FidsPreferences, "version">;

export interface FidsBoardRequest {
  page: number;
  lowerPage: number;
  signal?: AbortSignal;
}

export interface FidsConnectionState {
  connected: boolean;
  label: string;
  tone: "connected" | "offline" | "simulation";
}

export type FidsRefreshRequest =
  | { mode: "immediate" }
  | { mode: "realtime"; eventVersion: number | null };

export interface FidsDataSource {
  readonly kind: "live" | "simulation";
  readonly initialConnection: FidsConnectionState;
  loadPreferences(): Promise<FidsPreferences>;
  loadFilterOptions(): Promise<FidsFilterOptions>;
  loadBoard(request: FidsBoardRequest): Promise<FidsBoardResponse>;
  savePreferences(
    preferences: EditableFidsPreferences,
    expectedVersion: number,
  ): Promise<FidsPreferences>;
  subscribe(
    refresh: (request?: FidsRefreshRequest) => void,
    connectionChanged: (state: FidsConnectionState) => void,
  ): () => void;
}
