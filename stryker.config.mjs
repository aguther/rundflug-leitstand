/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.mutation.config.ts",
    related: true,
  },
  mutate: [
    "packages/domain/src/capacity.ts",
    "packages/domain/src/forecast-availability.ts",
    "packages/domain/src/forecast-diagnostics.ts",
    "packages/domain/src/forecast-dispatch-replay.ts",
    "packages/domain/src/forecast-sampling.ts",
    "packages/domain/src/outage-recovery.ts",
    "packages/domain/src/queue.ts",
    "packages/domain/src/ticket-group-recall.ts",
    "packages/domain/src/turnaround.ts",
  ],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation/mutation.html",
  },
  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },
  thresholds: {
    break: 73,
    low: 80,
    high: 90,
  },
  incremental: true,
  incrementalFile: "reports/mutation/incremental-v1.json",
  concurrency: 2,
  timeoutMS: 20_000,
  dryRunTimeoutMinutes: 5,
  ignorePatterns: ["apps/web/dist/**", "apps/worker/dist/**", "coverage/**", "output/**"],
};
