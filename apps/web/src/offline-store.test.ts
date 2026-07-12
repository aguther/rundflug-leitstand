import { describe, expect, it } from "vitest";
import { confirmedStateLabel, loadOperationBoard, saveOperationBoard } from "./offline-store";

describe("offline operation snapshot", () => {
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
  });
});
