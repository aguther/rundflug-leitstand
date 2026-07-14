import type { OperationBoard } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import {
  type BoardSyncState,
  isDeviceAuthorizationError,
  nextBoardReconnectDelay,
  OPERATION_BOARD_POLL_INTERVAL_MS,
  OPERATION_BOARD_RECONNECT_INITIAL_MS,
  OPERATION_BOARD_RECONNECT_MAX_MS,
  reduceBoardSyncState,
  requestBoardSync,
} from "./board-sync";

describe("operation board reconnection", () => {
  it("distinguishes a rejected device credential from a transient server failure", () => {
    expect(isDeviceAuthorizationError("Betriebsdaten nicht verfügbar (403)")).toBe(true);
    expect(isDeviceAuthorizationError("Betriebsdaten nicht verfügbar (401)")).toBe(true);
    expect(isDeviceAuthorizationError("Betriebsdaten nicht verfügbar (500)")).toBe(false);
    expect(isDeviceAuthorizationError(null)).toBe(false);
  });

  it("backs off reconnect attempts within the polling fallback bound", () => {
    let delay = OPERATION_BOARD_RECONNECT_INITIAL_MS;
    delay = nextBoardReconnectDelay(delay);
    expect(delay).toBe(2_000);
    delay = nextBoardReconnectDelay(delay);
    expect(delay).toBe(4_000);
    delay = nextBoardReconnectDelay(8_000);
    expect(delay).toBe(OPERATION_BOARD_RECONNECT_MAX_MS);
    expect(nextBoardReconnectDelay(delay)).toBe(OPERATION_BOARD_RECONNECT_MAX_MS);
    expect(OPERATION_BOARD_POLL_INTERVAL_MS).toBe(15_000);
  });

  it("keeps the last confirmation through a 60-second outage and accepts recovery automatically", async () => {
    const firstBoard = { event: { version: 10 } } as OperationBoard;
    const recoveredBoard = { event: { version: 11 } } as OperationBoard;
    let state: BoardSyncState = {
      board: firstBoard,
      lastConfirmedAt: "2026-07-12T06:00:00.000Z",
      error: null,
    };
    let elapsedMs = 0;

    while (elapsedMs < 60_000) {
      elapsedMs += OPERATION_BOARD_POLL_INTERVAL_MS;
      const outcome = await requestBoardSync(
        () => Promise.reject(new Error("Verbindung unterbrochen")),
        () => new Date(Date.parse("2026-07-12T06:00:00Z") + elapsedMs),
      );
      state = reduceBoardSyncState(state, outcome);
      expect(state.board).toBe(firstBoard);
      expect(state.lastConfirmedAt).toBe("2026-07-12T06:00:00.000Z");
      expect(state.error).toBe("Verbindung unterbrochen");
    }

    const recovered = await requestBoardSync(
      () => Promise.resolve(recoveredBoard),
      () => new Date("2026-07-12T06:01:05.000Z"),
    );
    state = reduceBoardSyncState(state, recovered);

    expect(state).toEqual({
      board: recoveredBoard,
      lastConfirmedAt: "2026-07-12T06:01:05.000Z",
      error: null,
    });
  });

  it("does not let an older cached snapshot replace a live confirmation", () => {
    const liveBoard = { event: { version: 5 } } as OperationBoard;
    const cachedBoard = { event: { version: 4 } } as OperationBoard;
    const state = reduceBoardSyncState(
      { board: liveBoard, lastConfirmedAt: "2026-07-12T06:00:05.000Z", error: null },
      { type: "RESTORED", board: cachedBoard, savedAt: "2026-07-12T06:00:00.000Z" },
    );

    expect(state.board).toBe(liveBoard);
    expect(state.lastConfirmedAt).toBe("2026-07-12T06:00:05.000Z");
  });

  it("rejects a delayed poll response with an older event version", () => {
    const currentBoard = { event: { version: 8 } } as OperationBoard;
    const delayedBoard = { event: { version: 7 } } as OperationBoard;
    const state = reduceBoardSyncState(
      { board: currentBoard, lastConfirmedAt: "2026-07-12T06:00:10.000Z", error: null },
      { type: "CONFIRMED", board: delayedBoard, confirmedAt: "2026-07-12T06:00:12.000Z" },
    );

    expect(state.board).toBe(currentBoard);
    expect(state.lastConfirmedAt).toBe("2026-07-12T06:00:10.000Z");
  });
});
