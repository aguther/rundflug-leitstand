import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const packageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> };
const verticalSlice = readFileSync(new URL("./verify_vertical_slice.mjs", import.meta.url), "utf8");
const planningHistoryScale = readFileSync(
  new URL("./verify_planning_history_scale.mjs", import.meta.url),
  "utf8",
);

function workflowJob(name: string, nextName: string): string {
  const startMarker = `  ${name}:`;
  const endMarker = `  ${nextName}:`;
  const start = workflow.indexOf(startMarker);
  const end = workflow.indexOf(endMarker, start + startMarker.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe("CI workflow dependency stability", () => {
  it("runs branch analysis in the existing quality job", () => {
    const qualityJob = workflowJob("check", "worker-runtime");

    expect(qualityJob).toContain("npm run test:coverage");
    expect(qualityJob).toContain("npm run sonar:scan --");
    expect(qualityJob).not.toContain("actions/download-artifact");
    expect(workflow).not.toContain("  sonar-branch:");
  });

  it("uses the lockfile-installed SonarQube scanner for pull requests", () => {
    const pullRequestJob = workflowJob("sonar-pull-request", "deploy-cloudflare");

    expect(pullRequestJob).toContain("uses: ./.github/actions/setup-project");
    expect(pullRequestJob).toContain("npm run sonar:scan --");
  });

  it("does not depend on the separately downloaded SonarSource action", () => {
    expect(workflow).not.toContain("SonarSource/sonarqube-scan-action");
    expect(packageManifest.scripts?.["sonar:scan"]).toBe("sonar-scanner-npm");
  });

  it("keeps functional realtime synchronization separate from latency budgets", () => {
    expect(verticalSlice).toContain('VERTICAL_SLICE_REALTIME_TIMEOUT_MS ?? "10000"');
    expect(verticalSlice).not.toContain("twoDevicesRealtimeUnderTwoSeconds");
    expect(verticalSlice).not.toContain("twoDevicesForecastUnderTwoSeconds");
  });

  it("separates planning-history wall latency from CPU degradation", () => {
    expect(planningHistoryScale).toContain("process.cpuUsage(lookupCpuStarted)");
    expect(planningHistoryScale).toContain('percentile95(duringSamples, "wallMs")');
    expect(planningHistoryScale).toContain('percentile95(duringSamples, "lookupCpuMs")');
    expect(planningHistoryScale).toContain("compactionP95Ms >= 2_000 || cpuDegradation > 0.1");
  });
});
