import type { OperationBoard } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type BoardSyncState,
  createBoardSyncCoordinator,
  nextBoardReconnectDelay,
  OPERATION_BOARD_POLL_INTERVAL_MS,
  OPERATION_BOARD_RECONNECT_INITIAL_MS,
  OPERATION_BOARD_RECONNECT_MAX_MS,
  reduceBoardSyncState,
  requestBoardSync,
} from "./board-sync";

describe("operation board reconnection", () => {
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

  it("coalesces simultaneous refreshes and waits for the requested version", async () => {
    let resolveFirst: ((board: OperationBoard) => void) | undefined;
    const first = new Promise<OperationBoard>((resolve) => {
      resolveFirst = resolve;
    });
    const load = vi
      .fn<() => Promise<OperationBoard>>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ event: { version: 12 } } as OperationBoard);
    const coordinator = createBoardSyncCoordinator(load);

    const initial = coordinator.request(11);
    const concurrent = coordinator.request(12);
    resolveFirst?.({ event: { version: 11 } } as OperationBoard);

    await expect(initial).resolves.toMatchObject({
      type: "CONFIRMED",
      board: { event: { version: 12 } },
    });
    await expect(concurrent).resolves.toMatchObject({
      type: "CONFIRMED",
      board: { event: { version: 12 } },
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reuses a confirmed snapshot for duplicate command and websocket refreshes", async () => {
    const load = vi
      .fn<() => Promise<OperationBoard>>()
      .mockResolvedValue({ event: { version: 7 } } as OperationBoard);
    const coordinator = createBoardSyncCoordinator(load);

    await coordinator.request(7);
    await coordinator.request(7);

    expect(load).toHaveBeenCalledOnce();
  });

  it("stops after one follow-up when a replica has not reached the requested version", async () => {
    const load = vi
      .fn<() => Promise<OperationBoard>>()
      .mockResolvedValue({ event: { version: 6 } } as OperationBoard);
    const coordinator = createBoardSyncCoordinator(load);

    await expect(coordinator.request(7)).resolves.toMatchObject({
      type: "CONFIRMED",
      board: { event: { version: 6 } },
    });

    expect(load).toHaveBeenCalledTimes(2);
  });
});
