import { describe, expect, it } from "vitest";
import { runD1ReadsSequentially } from "./d1-read-scheduler";

describe("runD1ReadsSequentially", () => {
  it("öffnet auch bei vielen Abfragen nur eine Verbindung gleichzeitig", async () => {
    let active = 0;
    let maximumActive = 0;
    const completionOrder: number[] = [];
    const tasks = Array.from({ length: 9 }, (_, index) => async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      completionOrder.push(index);
      active -= 1;
      return index;
    });

    const results = await runD1ReadsSequentially(tasks);

    expect(maximumActive).toBe(1);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(completionOrder).toEqual(results);
  });
});
