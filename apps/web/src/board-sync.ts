import type { OperationBoard } from "@rundflug/contracts";

export const OPERATION_BOARD_POLL_INTERVAL_MS = 15_000;
export const OPERATION_BOARD_RECONNECT_INITIAL_MS = 1_000;
export const OPERATION_BOARD_RECONNECT_MAX_MS = 15_000;

export function nextBoardReconnectDelay(currentDelayMs: number): number {
  return Math.min(currentDelayMs * 2, OPERATION_BOARD_RECONNECT_MAX_MS);
}

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

export interface BoardSyncCoordinator {
  request(minimumVersion?: number): Promise<BoardSyncOutcome>;
}

/**
 * Coalesces WebSocket, command-confirmation and polling refreshes into one board request.
 * A refresh that arrives while another request is running only causes one follow-up request,
 * and only when the first response did not yet reach the requested event version.
 */
export function createBoardSyncCoordinator(
  load: () => Promise<OperationBoard>,
  now: () => Date = () => new Date(),
): BoardSyncCoordinator {
  let inFlight: Promise<BoardSyncOutcome> | null = null;
  let requestedMinimumVersion = 0;
  let lastConfirmed: Extract<BoardSyncOutcome, { type: "CONFIRMED" }> | null = null;

  const run = async (): Promise<BoardSyncOutcome> => {
    let outcome: BoardSyncOutcome = {
      type: "UNAVAILABLE",
      message: "Betriebsdaten nicht verfügbar.",
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const targetVersion = requestedMinimumVersion;
      requestedMinimumVersion = 0;
      outcome = await requestBoardSync(load, now);
      if (outcome.type !== "CONFIRMED") return outcome;
      if (!lastConfirmed || outcome.board.event.version >= lastConfirmed.board.event.version) {
        lastConfirmed = outcome;
      }
      const latestTargetVersion = Math.max(targetVersion, requestedMinimumVersion);
      if (outcome.board.event.version >= latestTargetVersion) {
        requestedMinimumVersion = 0;
        return lastConfirmed;
      }
      requestedMinimumVersion = latestTargetVersion;
    }
    requestedMinimumVersion = 0;
    return lastConfirmed ?? outcome;
  };

  return {
    request(minimumVersion = 0) {
      if (
        minimumVersion > 0 &&
        lastConfirmed &&
        lastConfirmed.board.event.version >= minimumVersion
      ) {
        return Promise.resolve(lastConfirmed);
      }
      requestedMinimumVersion = Math.max(requestedMinimumVersion, minimumVersion);
      if (!inFlight) {
        inFlight = run().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}
