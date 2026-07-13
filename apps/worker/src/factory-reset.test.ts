import { describe, expect, it, vi } from "vitest";
import {
  emptyBackupBucket,
  FACTORY_RESET_DELETE_TABLES,
  factoryResetRequestHash,
} from "./factory-reset";

describe("factory reset", () => {
  it("covers operational, master, identity and bootstrap data without deleting reset receipts", () => {
    expect(FACTORY_RESET_DELETE_TABLES).toEqual(
      expect.arrayContaining([
        "tickets",
        "rotations",
        "products",
        "aircraft",
        "paired_devices",
        "operational_events",
        "app_bootstrap",
        "operation_days",
      ]),
    );
    expect(FACTORY_RESET_DELETE_TABLES).not.toContain("system_reset_receipts");
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("rotation_tickets")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("rotations"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("app_bootstrap")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("paired_devices"),
    );
  });

  it("hashes the anonymous reset intent without persisting the administrator PIN", async () => {
    const hash = await factoryResetRequestHash({
      commandId: "550e8400-e29b-41d4-a716-446655440501",
      eventId: "synthetic-event",
      reason: "Entwicklungsstand neu aufbauen",
      adminPin: "synthetic-pin",
      confirmation: "WERKSZUSTAND",
      retainRecoveryBackup: true,
      deleteAllBackups: false,
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("synthetic-pin");
  });

  it("empties every R2 page in bounded batches", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [{ key: "backups/one.json" }, { key: "reports/one.csv" }],
        truncated: true,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        objects: [{ key: "backups/two.json" }],
        truncated: false,
      });
    const remove = vi.fn().mockResolvedValue(undefined);
    await emptyBackupBucket({ list, delete: remove } as unknown as R2Bucket);
    expect(list).toHaveBeenNthCalledWith(1, {});
    expect(list).toHaveBeenNthCalledWith(2, { cursor: "next-page" });
    expect(remove).toHaveBeenNthCalledWith(1, ["backups/one.json", "reports/one.csv"]);
    expect(remove).toHaveBeenNthCalledWith(2, ["backups/two.json"]);
  });
});
