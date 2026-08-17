import { describe, expect, it } from "vitest";
import { pendingOnlineMigrations } from "./migration-safety.mjs";

const entries = [
  { file: "0001_baseline.sql", onlineSafe: false, initialOnly: true },
  { file: "0002_additive.sql", onlineSafe: true, initialOnly: false },
  { file: "0003_additive.sql", onlineSafe: true, initialOnly: false },
];

describe("migration deployment safety", () => {
  it("returns only unapplied online-safe migrations", () => {
    expect(pendingOnlineMigrations(entries, ["0001_baseline.sql", "0002_additive.sql"])).toEqual([
      entries[2],
    ]);
  });

  it("refuses to apply the initial baseline to an existing deployment", () => {
    expect(() => pendingOnlineMigrations(entries, [])).toThrow(/0001_baseline/);
  });
});
