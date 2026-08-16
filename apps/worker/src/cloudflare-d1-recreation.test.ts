import { describe, expect, it } from "vitest";
// @ts-expect-error The operational Node helper is executed directly as ESM and tested here.
import * as recreation from "../../../scripts/cloudflare-d1-recreation.mjs";

const manifest = {
  target: "acceptance",
  accountId: "account-synthetic",
  workerName: "rundflug-leitstand",
  d1Name: "rundflug-leitstand-db",
  d1DatabaseId: "database-old",
  r2Name: "rundflug-leitstand-backups",
  appEnv: "acceptance",
  jurisdiction: "eu",
};

describe("guarded Cloudflare D1 recreation", () => {
  it("defaults to a read-only preview unless the exact D1 confirmation is supplied", () => {
    expect(recreation.parseD1RecreationArguments(["--target", "acceptance"])).toEqual({
      target: "acceptance",
      accountId: null,
      confirmation: null,
    });
    expect(recreation.expectedRecreationConfirmation(manifest)).toBe(
      "DELETE-rundflug-leitstand-db",
    );
    expect(
      recreation.parseD1RecreationArguments([
        "--target",
        "acceptance",
        "--confirm",
        "DELETE-rundflug-leitstand-db",
      ]).confirmation,
    ).toBe("DELETE-rundflug-leitstand-db");
  });

  it("refuses incomplete, mismatched, and non-EU target manifests", () => {
    expect(() => recreation.validateRecreationManifest({}, "acceptance")).toThrow(/unvollständig/);
    expect(() => recreation.validateRecreationManifest(manifest, "production")).toThrow(
      /anderen Ziel/,
    );
    expect(() =>
      recreation.validateRecreationManifest({ ...manifest, jurisdiction: "us" }, "acceptance"),
    ).toThrow(/EU-Ziele/);
  });

  it("requires an exact D1 id and EU jurisdiction before allowing recreation", () => {
    const databaseList = [{ name: manifest.d1Name, uuid: manifest.d1DatabaseId }];
    expect(() =>
      recreation.verifyRemoteInventory(
        manifest,
        databaseList,
        { jurisdiction: "eu" },
        { location: "EEUR" },
      ),
    ).not.toThrow();
    expect(() =>
      recreation.verifyRemoteInventory(
        manifest,
        databaseList,
        { jurisdiction: "eu" },
        { location: "WEUR" },
      ),
    ).not.toThrow();
    expect(() =>
      recreation.verifyRemoteInventory(
        manifest,
        [{ name: manifest.d1Name, uuid: "database-other" }],
        { jurisdiction: "eu" },
        { jurisdiction: "eu" },
      ),
    ).toThrow(/nicht eindeutig/);
    expect(() =>
      recreation.verifyRemoteInventory(
        manifest,
        databaseList,
        { jurisdiction: "eu" },
        { location: "ENAM" },
      ),
    ).toThrow(/EU-Jurisdiktion/);
  });

  it("rebinds only D1 while preserving the worker, R2, account, and environment", () => {
    const baseConfig = {
      name: "base",
      vars: { APP_ENV: "acceptance", DATA_JURISDICTION: "eu" },
      d1_databases: [{ binding: "DB", database_id: "old" }],
      r2_buckets: [{ binding: "BACKUPS", bucket_name: "old" }],
    };
    const recreated = recreation.createRecreatedTargetState(baseConfig, manifest, "database-new");
    expect(recreated.config).toMatchObject({
      name: manifest.workerName,
      account_id: manifest.accountId,
      d1_databases: [
        {
          binding: "DB",
          database_name: manifest.d1Name,
          database_id: "database-new",
        },
      ],
      r2_buckets: [{ binding: "BACKUPS", bucket_name: manifest.r2Name, jurisdiction: "eu" }],
    });
    expect(recreated.manifest).toMatchObject({
      d1DatabaseId: "database-new",
      d1RecreationPending: false,
      workerName: manifest.workerName,
      r2Name: manifest.r2Name,
      jurisdiction: "eu",
    });
  });
});
