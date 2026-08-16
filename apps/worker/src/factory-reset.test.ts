import { describe, expect, it, vi } from "vitest";
import { applyDemoSeed, createD1TestDatabase } from "../test-support/migrated-database";
import {
  clearFactoryResetCoordinators,
  emptyBackupBucket,
  executeFactoryResetDatabase,
  FACTORY_RESET_DELETE_TABLES,
  factoryResetRequestHash,
} from "./factory-reset";
import type { Env } from "./types";

const RESET_DATABASE_INPUT = {
  commandId: "550e8400-e29b-41d4-a716-446655440502",
  completedAt: "2026-08-16T10:00:00.000Z",
  r2CleanupPending: false,
  requestHash: "a".repeat(64),
  response: {
    resetComplete: true,
    setupRequired: true,
    recoveryBackupKey: null,
    r2BackupsDeleted: false,
  },
  setupBrowserBindingHash: "b".repeat(64),
  setupGrantExpiresAt: "2026-08-16T10:30:00.000Z",
  setupGrantHash: "c".repeat(64),
} as const;

describe("factory reset", () => {
  it("covers operational, master, identity and bootstrap data without deleting reset receipts", () => {
    expect(FACTORY_RESET_DELETE_TABLES).toEqual(
      expect.arrayContaining([
        "tickets",
        "rotations",
        "products",
        "aircraft_product_turnaround_overrides",
        "aircraft",
        "paired_devices",
        "operator_sessions",
        "fids_preferences",
        "operator_accounts",
        "operational_events",
        "analysis_archive_events",
        "analysis_archives",
        "planning_runs",
        "planning_contexts",
        "planning_chunks",
        "app_bootstrap",
        "operation_days",
        "rotation_manifest_corrections",
        "planned_operational_constraints",
        "recurring_operational_rules",
      ]),
    );
    expect(FACTORY_RESET_DELETE_TABLES).not.toContain("system_reset_receipts");
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("analysis_archive_events")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("analysis_archives"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("forecast_snapshots")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("planning_runs"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("planning_runs")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("planning_contexts"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("planning_runs")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("planning_chunks"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("rotation_tickets")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("rotations"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("app_bootstrap")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("paired_devices"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("operator_sessions")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("operator_accounts"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("fids_preferences")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("operator_accounts"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("operational_blocks")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("planned_operational_constraints"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("planned_operational_constraints")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("rotations"),
    );
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("planned_operational_constraints")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("recurring_operational_rules"),
    );
    expect(
      FACTORY_RESET_DELETE_TABLES.indexOf("aircraft_product_turnaround_overrides"),
    ).toBeLessThan(FACTORY_RESET_DELETE_TABLES.indexOf("products"));
  });

  it("hashes the anonymous reset intent without persisting the administrator PIN", async () => {
    const hash = await factoryResetRequestHash({
      commandId: "550e8400-e29b-41d4-a716-446655440501",
      eventId: "synthetic-event",
      reason: "Entwicklungsstand neu aufbauen",
      adminPin: "123456",
      retainRecoveryBackup: true,
      deleteAllBackups: false,
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("123456");
  });

  it("executes the baseline reset and leaves only its technical receipt", async () => {
    const testDatabase = createD1TestDatabase();
    try {
      applyDemoSeed(testDatabase.database);
      const env = { DB: testDatabase.d1 } as Env;

      await executeFactoryResetDatabase(env, RESET_DATABASE_INPUT);

      for (const table of FACTORY_RESET_DELETE_TABLES) {
        const remaining = testDatabase.database
          .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
          .get() as { count: number };
        expect(remaining.count, table).toBe(0);
      }
      expect(
        testDatabase.database.prepare("SELECT command_id FROM system_reset_receipts").get(),
      ).toEqual({ command_id: RESET_DATABASE_INPUT.commandId });
      expect(
        testDatabase.database
          .prepare("SELECT active FROM system_reset_control WHERE singleton = 1")
          .get(),
      ).toEqual({ active: 0 });
      expect(testDatabase.database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      testDatabase.close();
    }
  });

  it("preserves administrator access after an interrupted bulk phase and succeeds on retry", async () => {
    const testDatabase = createD1TestDatabase();
    try {
      applyDemoSeed(testDatabase.database);
      let batchCalls = 0;
      let failAtCall: number | null = 3;
      const database = {
        prepare: (sql: string) => testDatabase.d1.prepare(sql),
        batch: async (statements: D1PreparedStatement[]) => {
          batchCalls += 1;
          if (batchCalls === failAtCall) throw new Error("synthetic interrupted D1 phase");
          return testDatabase.d1.batch(statements);
        },
      } as D1Database;

      await expect(
        executeFactoryResetDatabase({ DB: database } as Env, RESET_DATABASE_INPUT),
      ).rejects.toMatchObject({
        name: "FactoryResetDatabaseError",
        stage: "delete:planning-runs",
      });
      const activeAdministrators = testDatabase.database
        .prepare("SELECT COUNT(*) AS count FROM operator_accounts")
        .get() as { count: number };
      expect(activeAdministrators.count).toBeGreaterThan(0);
      expect(
        testDatabase.database
          .prepare("SELECT active FROM system_reset_control WHERE singleton = 1")
          .get(),
      ).toEqual({ active: 0 });

      failAtCall = null;
      await executeFactoryResetDatabase({ DB: database } as Env, RESET_DATABASE_INPUT);

      expect(
        testDatabase.database.prepare("SELECT COUNT(*) AS count FROM operator_accounts").get(),
      ).toEqual({ count: 0 });
      expect(testDatabase.database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      testDatabase.close();
    }
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

  it("clears many historical event coordinators without concurrent subrequests", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const cleared: string[] = [];
    const namespace = {
      idFromName: (eventId: string) => eventId,
      get: (eventId: string) => ({
        fetch: async () => {
          activeRequests += 1;
          maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
          await Promise.resolve();
          cleared.push(eventId);
          activeRequests -= 1;
          return new Response(null, { status: 204 });
        },
      }),
    };
    const eventIds = Array.from({ length: 62 }, (_, index) => `synthetic-history-${index + 1}`);

    await clearFactoryResetCoordinators(namespace as unknown as DurableObjectNamespace, eventIds);

    expect(cleared).toEqual(eventIds);
    expect(maximumActiveRequests).toBe(1);
  });
});
