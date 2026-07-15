import { describe, expect, it } from "vitest";
import {
  appendCashierDraftRevision,
  cashierDraftQueueKey,
  latestCashierDraft,
  readCashierDraftQueue,
  writeCashierDraftQueue,
} from "./offline-drafts";

describe("cashier offline draft queue", () => {
  it("keeps only the current reversible draft without treating UI clicks as commands", () => {
    const first = appendCashierDraftRevision(
      [],
      { productId: "p1", size: 2 },
      "revision-1",
      "2026-07-12T06:00:00.000Z",
    );
    const second = appendCashierDraftRevision(
      first,
      { productId: "p1", size: 3 },
      "revision-2",
      "2026-07-12T06:00:05.000Z",
    );

    expect(second.map((entry) => entry.id)).toEqual(["revision-2"]);
    expect(latestCashierDraft(second)).toEqual({ productId: "p1", size: 3 });
  });

  it("deduplicates unchanged drafts and replaces the previous local value", () => {
    let queue = appendCashierDraftRevision(
      [],
      { productId: "p1", size: 1 },
      "same",
      "2026-07-12T06:00:00.000Z",
    );
    queue = appendCashierDraftRevision(queue, { productId: "p1", size: 1 });
    expect(queue).toHaveLength(1);

    for (let index = 0; index < 60; index += 1) {
      queue = appendCashierDraftRevision(
        queue,
        { productId: `p-${index}`, size: 1 },
        `revision-${index}`,
        new Date(Date.UTC(2026, 6, 12, 6, 1, index)).toISOString(),
      );
    }
    expect(queue).toHaveLength(1);
    expect(queue[0]?.id).toBe("revision-59");
  });

  it("persists only validated, event-and-device-scoped draft data", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const key = cashierDraftQueueKey("event-a", "cashier-a");
    const queue = appendCashierDraftRevision(
      [],
      { productId: "p1", size: 2 },
      "revision-1",
      "2026-07-12T06:00:00.000Z",
    );

    writeCashierDraftQueue(storage, key, queue);
    expect(readCashierDraftQueue(storage, key)).toEqual(queue);
    expect(key).toContain("event-a:cashier-a");
  });

  it("collapses legacy revision histories to their newest valid draft", () => {
    const storage = {
      getItem: () =>
        JSON.stringify([
          {
            id: "old",
            createdAt: "2026-07-12T06:00:00.000Z",
            draft: { productId: "p1", size: 2 },
          },
          {
            id: "current",
            createdAt: "2026-07-12T06:00:05.000Z",
            draft: { productId: "p1", size: 4 },
          },
        ]),
    };

    expect(readCashierDraftQueue(storage, "legacy").map((entry) => entry.id)).toEqual(["current"]);
  });
});
