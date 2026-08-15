import { describe, expect, it } from "vitest";
// @ts-expect-error The operational Node helper is executed directly as ESM and tested here.
import * as maintenance from "../../../scripts/cloudflare-maintenance.mjs";

const configuration = {
  compatibility_date: "2026-08-15",
  compatibility_flags: ["nodejs_compat"],
  observability: {
    enabled: true,
    logs: { enabled: true, persist: true, head_sampling_rate: 1 },
    traces: { enabled: true, persist: true, head_sampling_rate: 0.01 },
  },
};

const packageJson = {
  devDependencies: {
    wrangler: "4.123.0",
    "@cloudflare/workers-types": "5.20260815.1",
  },
};

const packageLock = {
  packages: {
    "node_modules/wrangler": {
      version: "4.123.0",
      dependencies: { workerd: "1.20260811.1" },
    },
    "node_modules/workerd": { version: "1.20260811.1" },
    "node_modules/@cloudflare/workers-types": { version: "5.20260815.1" },
    "node_modules/@cloudflare/vitest-pool-workers": {
      version: "0.21.3",
      dependencies: { wrangler: "4.123.0" },
    },
  },
};

describe("Cloudflare maintenance policy", () => {
  it("reports age without destabilizing ordinary checks", () => {
    expect(
      maintenance.verifyCloudflareConfiguration(configuration, {
        now: new Date("2026-10-01T12:00:00Z"),
      }),
    ).toEqual({ compatibilityDate: "2026-08-15", ageDays: 47 });
  });

  it("enforces the 45-day limit only when requested by maintenance", () => {
    expect(() =>
      maintenance.verifyCloudflareConfiguration(configuration, {
        now: new Date("2026-09-29T12:00:00Z"),
        enforceCompatibilityAge: true,
      }),
    ).not.toThrow();
    expect(() =>
      maintenance.verifyCloudflareConfiguration(configuration, {
        now: new Date("2026-10-01T12:00:00Z"),
        enforceCompatibilityAge: true,
      }),
    ).toThrow(/45-Tage-Limit/);
  });

  it("requires persisted sampled logs and traces", () => {
    expect(() =>
      maintenance.verifyCloudflareConfiguration(
        {
          ...configuration,
          observability: { ...configuration.observability, traces: { enabled: false } },
        },
        { now: new Date("2026-08-15T12:00:00Z") },
      ),
    ).toThrow(/Logs und Traces/);
  });

  it("verifies the locked Wrangler runtime and generated binding provenance", () => {
    const generated =
      "// Runtime types generated with workerd@1.20260811.1 2026-08-15 nodejs_compat";
    expect(maintenance.verifyCloudflareToolchain(packageJson, packageLock, generated)).toEqual({
      wrangler: "4.123.0",
      workerd: "1.20260811.1",
      workersTypes: "5.20260815.1",
      workerTestPool: "0.21.3",
    });
    expect(() =>
      maintenance.verifyCloudflareToolchain(
        packageJson,
        {
          packages: {
            ...packageLock.packages,
            "node_modules/workerd": { version: "1.20260812.1" },
          },
        },
        generated,
      ),
    ).toThrow(/nicht aufeinander abgestimmt/);
    expect(() => maintenance.verifyGeneratedCompatibilityDate(generated, "2026-08-14")).toThrow(
      /Compatibility-Date/,
    );
  });
});
