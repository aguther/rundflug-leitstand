import {
  type FidsBoardResponse,
  type FidsPreferences,
  fidsPreferencesSchema,
} from "@rundflug/contracts";
import { filterFidsRows, paginateFidsRows, partitionFidsRows } from "@rundflug/domain";
import type { SimulationOperationalModel } from "../forecast-simulation/model";
import type { SimulationFidsBoard } from "../forecast-simulation/simulation-fids";
import type { FidsDataSource } from "./fids-data-source";

export function createSimulationFidsDataSource(input: {
  board: SimulationFidsBoard;
  operationalModel?: SimulationOperationalModel;
  preferences: FidsPreferences;
  onPreferencesChanged: (preferences: FidsPreferences) => void;
}): FidsDataSource {
  return {
    kind: "simulation",
    initialConnection: { connected: true, label: "LIVE-SIMULATION", tone: "simulation" },
    loadPreferences: async () => input.preferences,
    loadFilterOptions: async () => ({
      gates: (input.operationalModel?.gates ?? []).map((gate) => ({
        id: gate.id,
        label: gate.label,
        active: true,
      })),
      products: (input.operationalModel?.products ?? []).map((product) => ({
        id: product.id,
        code: product.code,
        name: product.name,
        gateId: product.gateId,
        active: true,
      })),
    }),
    loadBoard: async ({ page, lowerPage }) => {
      const filteredRows = filterFidsRows(input.board.groups, input.preferences.contentFilter);
      const projection =
        input.preferences.viewMode === "SPLIT"
          ? partitionFidsRows({
              rows: filteredRows,
              visibleRows: input.preferences.visibleRows,
              priorityGroupCount: input.preferences.priorityGroupCount,
              lowerPage,
            })
          : {
              priority: null,
              page: paginateFidsRows(filteredRows, page, input.preferences.visibleRows),
            };
      return {
        eventName: input.board.eventName,
        timeZone: input.board.timeZone,
        emergencyMode: input.board.emergencyMode,
        operationalInterrupted: input.board.operationalInterrupted,
        operationalNotice: input.board.operationalNotice,
        departedVisibilitySeconds: input.board.departedVisibilitySeconds,
        updatedAt: input.board.updatedAt,
        preferencesVersion: input.preferences.version,
        viewMode: input.preferences.viewMode,
        filterSummary: input.preferences.contentFilter,
        priority: projection.priority,
        page: projection.page,
        fleet: input.board.fleet,
      } satisfies FidsBoardResponse;
    },
    savePreferences: async (preferences, expectedVersion) => {
      if (expectedVersion !== input.preferences.version) {
        throw new Error("Die Simulationseinstellungen wurden zwischenzeitlich geändert.");
      }
      const saved = fidsPreferencesSchema.parse({
        ...preferences,
        version: expectedVersion + 1,
      });
      input.onPreferencesChanged(saved);
      return saved;
    },
    subscribe: (_refresh, connectionChanged) => {
      connectionChanged({ connected: true, label: "LIVE-SIMULATION", tone: "simulation" });
      return () => undefined;
    },
  };
}
