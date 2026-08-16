import { describe, expect, it, vi } from "vitest";
import type { BackupReason } from "./backup";
import {
  runScheduledMaintenance,
  type ScheduledMaintenanceDependencies,
} from "./scheduled-maintenance";
import type { Env } from "./types";

const NOW = new Date("2026-08-11T03:00:00.000Z");

function createHarness(upcomingOperationCount = 1) {
  const first = vi.fn(async () => ({ count: upcomingOperationCount }));
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  const env = { DB: { prepare } } as unknown as Env;
  const logger = {
    error: vi.fn<(event: Record<string, unknown>) => void>(),
    log: vi.fn<(event: Record<string, unknown>) => void>(),
  };
  const purgeExpiredPushSubscriptions = vi.fn(async (_env: Env, _now?: Date): Promise<number> => 3);
  const expireAnalysisArchives = vi.fn(
    async (_env: Env, _now?: Date, _limit?: number): Promise<number> => 2,
  );
  const processPendingAnalysisArchives = vi.fn(
    async (_env: Env, _limit?: number): Promise<number> => 1,
  );
  const expirePlanningHistoryPackages = vi.fn(
    async (_env: Env, _now?: Date, _limit?: number): Promise<number> => 4,
  );
  const createPortableBackup = vi.fn(async (_env: Env, _now?: Date, _reason?: BackupReason) => ({
    key: "backups/2026-08-11/backup.json",
    checksum: "backup-checksum",
  }));
  const operationDateInTimeZone = vi.fn((_date: Date, _timeZone?: string) => "2026-08-12");
  const dependencies = {
    createPortableBackup,
    expireAnalysisArchives,
    expirePlanningHistoryPackages,
    logger,
    operationDateInTimeZone,
    processPendingAnalysisArchives,
    purgeExpiredPushSubscriptions,
  } satisfies ScheduledMaintenanceDependencies;

  return {
    createPortableBackup,
    dependencies,
    env,
    expireAnalysisArchives,
    expirePlanningHistoryPackages,
    first,
    logger,
    processPendingAnalysisArchives,
    purgeExpiredPushSubscriptions,
  };
}

function loggedEvents(mock: ReturnType<typeof vi.fn<(event: Record<string, unknown>) => void>>) {
  return mock.mock.calls.map(([event]) => event);
}

describe("runScheduledMaintenance", () => {
  it("runs every step and records a successful structured summary", async () => {
    const harness = createHarness();

    await runScheduledMaintenance(harness.env, NOW, harness.dependencies);

    expect(harness.purgeExpiredPushSubscriptions).toHaveBeenCalledWith(harness.env, NOW);
    expect(harness.expireAnalysisArchives).toHaveBeenCalledWith(harness.env, NOW);
    expect(harness.processPendingAnalysisArchives).toHaveBeenCalledWith(harness.env);
    expect(harness.expirePlanningHistoryPackages).toHaveBeenCalledWith(harness.env, NOW);
    expect(harness.createPortableBackup).toHaveBeenCalledWith(harness.env, NOW, "PRE_EVENT");
    expect(harness.logger.error).not.toHaveBeenCalled();
    expect(loggedEvents(harness.logger.log)).toContainEqual(
      expect.objectContaining({
        code: "SCHEDULED_MAINTENANCE_COMPLETED",
        status: "SUCCESS",
        failedSteps: [],
        purgedPushSubscriptions: 3,
        expiredAnalysisArchives: 2,
        builtAnalysisArchives: 1,
        expiredPlanningHistoryPackages: 4,
        backupReason: "PRE_EVENT",
      }),
    );
  });

  it.each([
    ["push cleanup", "purgeExpiredPushSubscriptions", "PURGE_EXPIRED_PUSH_SUBSCRIPTIONS"],
    ["archive expiry", "expireAnalysisArchives", "EXPIRE_ANALYSIS_ARCHIVES"],
    ["archive building", "processPendingAnalysisArchives", "BUILD_ANALYSIS_ARCHIVES"],
    [
      "planning history expiry",
      "expirePlanningHistoryPackages",
      "EXPIRE_PLANNING_HISTORY_PACKAGES",
    ],
  ] as const)(
    "attempts the portable backup after a failed %s step",
    async (_label, dependencyName, expectedStep) => {
      const harness = createHarness();
      harness[dependencyName].mockRejectedValueOnce(new TypeError("sensitive diagnostic"));

      await expect(runScheduledMaintenance(harness.env, NOW, harness.dependencies)).rejects.toThrow(
        `Scheduled maintenance failed: ${expectedStep}`,
      );

      expect(harness.createPortableBackup).toHaveBeenCalledWith(harness.env, NOW, "PRE_EVENT");
      const errorLogs = loggedEvents(harness.logger.error);
      expect(errorLogs).toContainEqual(
        expect.objectContaining({
          code: "SCHEDULED_MAINTENANCE_STEP_FAILED",
          step: expectedStep,
          errorType: "TypeError",
        }),
      );
      expect(errorLogs).toContainEqual(
        expect.objectContaining({
          code: "SCHEDULED_MAINTENANCE_COMPLETED",
          status: "FAILED",
          failedSteps: [expectedStep],
          backupKey: "backups/2026-08-11/backup.json",
        }),
      );
      expect(JSON.stringify(errorLogs)).not.toContain("sensitive diagnostic");
    },
  );

  it("uses a daily backup fallback when the pre-event lookup fails", async () => {
    const harness = createHarness();
    harness.first.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(runScheduledMaintenance(harness.env, NOW, harness.dependencies)).rejects.toThrow(
      "Scheduled maintenance failed: RESOLVE_BACKUP_REASON",
    );

    expect(harness.createPortableBackup).toHaveBeenCalledWith(harness.env, NOW, "DAILY");
  });

  it("reports a failed backup after all earlier jobs completed", async () => {
    const harness = createHarness(0);
    harness.createPortableBackup.mockRejectedValueOnce(new Error("R2 unavailable"));

    await expect(runScheduledMaintenance(harness.env, NOW, harness.dependencies)).rejects.toThrow(
      "Scheduled maintenance failed: CREATE_PORTABLE_BACKUP",
    );

    expect(harness.purgeExpiredPushSubscriptions).toHaveBeenCalledOnce();
    expect(harness.expireAnalysisArchives).toHaveBeenCalledOnce();
    expect(harness.processPendingAnalysisArchives).toHaveBeenCalledOnce();
    expect(harness.createPortableBackup).toHaveBeenCalledWith(harness.env, NOW, "DAILY");
  });
});
