import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOfflineOperationBoards,
  confirmedStateLabel,
  loadOperationBoard,
  saveOperationBoard,
} from "./offline-store";

describe("offline operation snapshot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the age of the last server-confirmed state", () => {
    expect(
      confirmedStateLabel("2026-07-12T06:00:00.000Z", Date.parse("2026-07-12T06:00:42Z")),
    ).toBe("letzte Bestätigung vor 42 s");
    expect(
      confirmedStateLabel("2026-07-12T06:00:00.000Z", Date.parse("2026-07-12T06:02:01Z")),
    ).toBe("letzte Bestätigung vor 2 min");
  });

  it("degrades safely when IndexedDB is unavailable", async () => {
    await expect(loadOperationBoard("event", "device")).resolves.toBeNull();
    await expect(saveOperationBoard("event", "device", {} as never)).resolves.toBeUndefined();
    await expect(clearOfflineOperationBoards()).resolves.toBeUndefined();
  });

  it("rejects transaction failures with an Error when IndexedDB provides no cause", async () => {
    const close = vi.fn();
    const transaction = {
      error: null,
      objectStore: () => ({ put: vi.fn() }),
      onabort: null as ((event: Event) => void) | null,
      oncomplete: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
    };
    const database = {
      close,
      objectStoreNames: { contains: () => true },
      transaction: () => {
        queueMicrotask(() => transaction.onerror?.(new Event("error")));
        return transaction;
      },
    };
    const openRequest = {
      error: null,
      onerror: null as ((event: Event) => void) | null,
      onsuccess: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: Event) => void) | null,
      result: database,
    };
    vi.stubGlobal("indexedDB", {
      open: () => {
        queueMicrotask(() => openRequest.onsuccess?.(new Event("success")));
        return openRequest;
      },
    });

    await expect(saveOperationBoard("event", "device", {} as never)).rejects.toBeInstanceOf(Error);
    expect(close).toHaveBeenCalledOnce();
  });
});
