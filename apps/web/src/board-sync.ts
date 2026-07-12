import type { OperationBoard } from "@rundflug/contracts";

export const OPERATION_BOARD_POLL_INTERVAL_MS = 5_000;

export interface BoardSyncState {
  board: OperationBoard | null;
  lastConfirmedAt: string | null;
  error: string | null;
}

export type BoardSyncOutcome =
  | { type: "RESTORED"; board: OperationBoard; savedAt: string }
  | { type: "CONFIRMED"; board: OperationBoard; confirmedAt: string }
  | { type: "UNAVAILABLE"; message: string };

export function reduceBoardSyncState(
  state: BoardSyncState,
  outcome: BoardSyncOutcome,
): BoardSyncState {
  if (outcome.type === "UNAVAILABLE") return { ...state, error: outcome.message };
  if (outcome.type === "RESTORED") {
    return state.board
      ? state
      : { board: outcome.board, lastConfirmedAt: outcome.savedAt, error: state.error };
  }
  if (state.board && outcome.board.event.version < state.board.event.version) return state;
  return { board: outcome.board, lastConfirmedAt: outcome.confirmedAt, error: null };
}

export async function requestBoardSync(
  load: () => Promise<OperationBoard>,
  now: () => Date = () => new Date(),
): Promise<BoardSyncOutcome> {
  try {
    return { type: "CONFIRMED", board: await load(), confirmedAt: now().toISOString() };
  } catch (reason) {
    return {
      type: "UNAVAILABLE",
      message: reason instanceof Error ? reason.message : "Betriebsdaten nicht verfügbar.",
    };
  }
}
