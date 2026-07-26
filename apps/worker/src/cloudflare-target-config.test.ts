// @ts-expect-error The configuration test runs in Node, outside the Worker runtime.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error The operational Node helper is executed directly as ESM and tested here.
import * as cloudflareTarget from "../../../scripts/cloudflare-target.mjs";

const {
  cloudflareAccountId,
  createTargetWranglerConfig,
  deploymentUrl,
  parseCloudflareTargetArguments,
  rateLimitNamespaceId,
} = cloudflareTarget;

describe("Cloudflare target configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the deterministic compatibility inventory in the checked-in configuration", () => {
    const config = JSON.parse(
      readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"),
    );
    expect(config.secrets).toEqual({ required: cloudflareTarget.compatibilityProfileSecrets });
  });

  it("derives safe resource names from one target", () => {
    expect(
      parseCloudflareTargetArguments(["--target", "verein-abnahme", "--dry-run"]),
    ).toMatchObject({
      target: "verein-abnahme",
      workerName: "rundflug-leitstand-verein-abnahme",
      d1Name: "rundflug-leitstand-verein-abnahme-db",
      r2Name: "rundflug-leitstand-verein-abnahme-backups",
      appEnv: "acceptance",
      dryRun: true,
    });
  });

  it("accepts explicit names and protects production", () => {
    expect(() =>
      parseCloudflareTargetArguments(["--target", "produktion", "--app-env", "production"]),
    ).toThrow(/confirm-production/);
    expect(
      parseCloudflareTargetArguments([
        "--target",
        "produktion",
        "--worker-name",
        "leitstand-produktiv",
        "--d1-name",
        "leitstand-produktiv-db",
        "--r2-name",
        "leitstand-produktiv-backups",
        "--app-env",
        "production",
        "--confirm-production",
      ]),
    ).toMatchObject({ appEnv: "production", workerName: "leitstand-produktiv" });
  });

  it("rejects unsafe names and unknown arguments", () => {
    expect(() => parseCloudflareTargetArguments(["--target", "../production"])).toThrow(
      /Kleinbuchstaben/,
    );
    expect(() =>
      parseCloudflareTargetArguments(["--target", "acceptance", "--delete-existing"]),
    ).toThrow(/Unbekanntes Argument/);
  });

  it("generates complete isolated bindings without mutating the base configuration", () => {
    const base = {
      name: "original",
      vars: { APP_ENV: "acceptance", DATA_JURISDICTION: "eu" },
      d1_databases: [{ binding: "DB", database_id: "old" }],
      r2_buckets: [{ binding: "BACKUPS", bucket_name: "old" }],
    };
    const profile = parseCloudflareTargetArguments(["--target", "verein-abnahme"]);
    const generated = createTargetWranglerConfig(base, profile, "new-database-id");
    expect(generated.name).toBe("rundflug-leitstand-verein-abnahme");
    expect(generated.d1_databases[0]).toMatchObject({
      database_name: "rundflug-leitstand-verein-abnahme-db",
      database_id: "new-database-id",
    });
    expect(generated.r2_buckets[0]).toMatchObject({
      bucket_name: "rundflug-leitstand-verein-abnahme-backups",
      jurisdiction: "eu",
    });
    expect(generated.secrets).toEqual({ required: cloudflareTarget.requiredCloudflareSecrets });
    expect(base.d1_databases[0]?.database_id).toBe("old");
  });

  it("selects one explicit account and refuses an ambiguous login", () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", undefined);
    const payload = { accounts: [{ id: "account-a" }, { id: "account-b" }] };
    expect(cloudflareAccountId(payload, "account-b")).toBe("account-b");
    expect(() => cloudflareAccountId(payload)).toThrow(/mehreren Cloudflare-Accounts/);
    expect(() => cloudflareAccountId(payload, "account-c")).toThrow(/gehört nicht/);
  });

  it("uses stable distinct rate-limit namespaces and recognizes deployment URLs", () => {
    expect(rateLimitNamespaceId("a-target", "public-ticket")).toMatch(/^\d+$/);
    expect(rateLimitNamespaceId("a-target", "public-ticket")).not.toBe(
      rateLimitNamespaceId("a-target", "admin-recovery"),
    );
    expect(deploymentUrl("Deployed to https://leitstand.example.workers.dev")).toBe(
      "https://leitstand.example.workers.dev",
    );
  });
});
