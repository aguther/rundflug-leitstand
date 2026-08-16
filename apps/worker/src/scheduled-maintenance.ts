import { expireAnalysisArchives, processPendingAnalysisArchives } from "./analysis-archive";
import { createPortableBackup, operationDateInTimeZone } from "./backup";
import { expirePlanningHistoryPackages } from "./planning-history-compaction";
import type { Env } from "./types";
import { purgeExpiredPushSubscriptions } from "./web-push";

type BackupReason = "DAILY" | "PRE_EVENT";

type MaintenanceStep =
  | "PURGE_EXPIRED_PUSH_SUBSCRIPTIONS"
  | "EXPIRE_ANALYSIS_ARCHIVES"
  | "BUILD_ANALYSIS_ARCHIVES"
  | "EXPIRE_PLANNING_HISTORY_PACKAGES"
  | "RESOLVE_BACKUP_REASON"
  | "CREATE_PORTABLE_BACKUP";

interface MaintenanceLogger {
  error(event: Record<string, unknown>): void;
  log(event: Record<string, unknown>): void;
}

export interface ScheduledMaintenanceDependencies {
  createPortableBackup: typeof createPortableBackup;
  expireAnalysisArchives: typeof expireAnalysisArchives;
  expirePlanningHistoryPackages: typeof expirePlanningHistoryPackages;
  logger: MaintenanceLogger;
  operationDateInTimeZone: typeof operationDateInTimeZone;
  processPendingAnalysisArchives: typeof processPendingAnalysisArchives;
  purgeExpiredPushSubscriptions: typeof purgeExpiredPushSubscriptions;
}

const defaultDependencies: ScheduledMaintenanceDependencies = {
  createPortableBackup,
  expireAnalysisArchives,
  expirePlanningHistoryPackages,
  logger: console,
  operationDateInTimeZone,
  processPendingAnalysisArchives,
  purgeExpiredPushSubscriptions,
};

type StepOutcome<T> = { status: "fulfilled"; value: T } | { status: "rejected" };

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function runMaintenanceStep<T>(
  step: MaintenanceStep,
  timestamp: string,
  failedSteps: MaintenanceStep[],
  logger: MaintenanceLogger,
  action: () => Promise<T>,
  resultDetails: (value: T) => Record<string, unknown>,
): Promise<StepOutcome<T>> {
  try {
    const value = await action();
    logger.log({
      level: "info",
      code: "SCHEDULED_MAINTENANCE_STEP_COMPLETED",
      step,
      ...resultDetails(value),
      timestamp,
    });
    return { status: "fulfilled", value };
  } catch (error) {
    failedSteps.push(step);
    logger.error({
      level: "error",
      code: "SCHEDULED_MAINTENANCE_STEP_FAILED",
      step,
      errorType: errorType(error),
      timestamp,
    });
    return { status: "rejected" };
  }
}

export async function runScheduledMaintenance(
  env: Env,
  now = new Date(),
  dependencies: ScheduledMaintenanceDependencies = defaultDependencies,
): Promise<void> {
  const timestamp = now.toISOString();
  const failedSteps: MaintenanceStep[] = [];

  const purgedPushSubscriptions = await runMaintenanceStep(
    "PURGE_EXPIRED_PUSH_SUBSCRIPTIONS",
    timestamp,
    failedSteps,
    dependencies.logger,
    () => dependencies.purgeExpiredPushSubscriptions(env, now),
    (count) => ({ count }),
  );
  const expiredAnalysisArchives = await runMaintenanceStep(
    "EXPIRE_ANALYSIS_ARCHIVES",
    timestamp,
    failedSteps,
    dependencies.logger,
    () => dependencies.expireAnalysisArchives(env, now),
    (count) => ({ count }),
  );
  const builtAnalysisArchives = await runMaintenanceStep(
    "BUILD_ANALYSIS_ARCHIVES",
    timestamp,
    failedSteps,
    dependencies.logger,
    () => dependencies.processPendingAnalysisArchives(env),
    (count) => ({ count }),
  );
  const expiredPlanningHistoryPackages = await runMaintenanceStep(
    "EXPIRE_PLANNING_HISTORY_PACKAGES",
    timestamp,
    failedSteps,
    dependencies.logger,
    () => dependencies.expirePlanningHistoryPackages(env, now),
    (count) => ({ count }),
  );

  const backupReasonResult = await runMaintenanceStep(
    "RESOLVE_BACKUP_REASON",
    timestamp,
    failedSteps,
    dependencies.logger,
    async (): Promise<BackupReason> => {
      const nextOperationDate = dependencies.operationDateInTimeZone(
        new Date(now.getTime() + 24 * 60 * 60 * 1000),
      );
      const upcoming = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM operation_days
          WHERE event_date = ?1 AND status IN ('PREPARATION', 'ACTIVE')`,
      )
        .bind(nextOperationDate)
        .first<{ count: number }>();
      return (upcoming?.count ?? 0) > 0 ? "PRE_EVENT" : "DAILY";
    },
    (reason) => ({ reason }),
  );
  const backupReason =
    backupReasonResult.status === "fulfilled" ? backupReasonResult.value : "DAILY";
  const portableBackup = await runMaintenanceStep(
    "CREATE_PORTABLE_BACKUP",
    timestamp,
    failedSteps,
    dependencies.logger,
    () => dependencies.createPortableBackup(env, now, backupReason),
    (result) => ({ key: result.key, checksum: result.checksum, reason: backupReason }),
  );

  const summary = {
    level: failedSteps.length === 0 ? "info" : "error",
    code: "SCHEDULED_MAINTENANCE_COMPLETED",
    status: failedSteps.length === 0 ? "SUCCESS" : "FAILED",
    failedSteps,
    purgedPushSubscriptions:
      purgedPushSubscriptions.status === "fulfilled" ? purgedPushSubscriptions.value : null,
    expiredAnalysisArchives:
      expiredAnalysisArchives.status === "fulfilled" ? expiredAnalysisArchives.value : null,
    builtAnalysisArchives:
      builtAnalysisArchives.status === "fulfilled" ? builtAnalysisArchives.value : null,
    expiredPlanningHistoryPackages:
      expiredPlanningHistoryPackages.status === "fulfilled"
        ? expiredPlanningHistoryPackages.value
        : null,
    backupKey: portableBackup.status === "fulfilled" ? portableBackup.value.key : null,
    backupReason,
    timestamp,
  };
  if (failedSteps.length === 0) dependencies.logger.log(summary);
  else dependencies.logger.error(summary);

  if (failedSteps.length > 0) {
    throw new Error(`Scheduled maintenance failed: ${failedSteps.join(", ")}`);
  }
}
