import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  type DeploymentBackupRouteDependencies,
  registerDeploymentBackupRoutes,
} from "./deployment-backup-routes";
import type { Env } from "./types";

const SOURCE_REVISION = "a".repeat(40);
const NOW = new Date("2026-08-17T10:00:00.000Z");

function createHarness(priorRecord?: Record<string, unknown>) {
  const get = vi.fn(async () => (priorRecord ? { json: async () => priorRecord } : null));
  const put = vi.fn(async () => undefined);
  const env = {
    BACKUPS: { get, put },
    DEPLOYMENT_BACKUP_TOKEN_HASH: "b".repeat(64),
  } as unknown as Env;
  const dependencies = {
    createPortableBackup: vi.fn(async () => ({
      key: `backups/deployments/${SOURCE_REVISION}.zip`,
      checksum: "c".repeat(64),
    })),
    now: () => NOW,
    verifyCredential: vi.fn(async (token: string | null) => token === "synthetic-token"),
  } satisfies DeploymentBackupRouteDependencies;
  const app = new Hono<{ Bindings: Env; Variables: { sessionActor: null } }>();
  registerDeploymentBackupRoutes(app as never, dependencies);
  const request = (
    input: { token?: string; sourceRevision?: string; idempotencyKey?: string } = {},
  ) =>
    app.request(
      "/api/internal/deployment-backups",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.token ?? "synthetic-token"}`,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey ?? SOURCE_REVISION,
        },
        body: JSON.stringify({
          sourceRevision: input.sourceRevision ?? SOURCE_REVISION,
          bookmark: "00000000-0000002a",
        }),
      },
      env,
    );
  return { request, dependencies, get, put };
}

describe("deployment backup route", () => {
  it("conceals the route from unauthorized callers", async () => {
    const harness = createHarness();
    const response = await harness.request({ token: "wrong-token" });

    expect(response.status).toBe(404);
    expect(harness.get).not.toHaveBeenCalled();
    expect(harness.dependencies.createPortableBackup).not.toHaveBeenCalled();
  });

  it("requires a commit revision and matching idempotency key", async () => {
    const harness = createHarness();
    const response = await harness.request({
      sourceRevision: "invalid",
      idempotencyKey: "invalid",
    });

    expect(response.status).toBe(400);
    expect(harness.get).not.toHaveBeenCalled();
  });

  it("creates one deterministic portable backup before deployment", async () => {
    const harness = createHarness();
    const response = await harness.request();

    expect(response.status).toBe(201);
    expect(harness.dependencies.createPortableBackup).toHaveBeenCalledWith(
      expect.anything(),
      NOW,
      "PRE_DEPLOY",
      { objectKey: `backups/deployments/${SOURCE_REVISION}.zip` },
    );
    expect(harness.put).toHaveBeenCalledWith(
      `deployment-records/${SOURCE_REVISION}.json`,
      expect.stringContaining(`"sourceRevision":"${SOURCE_REVISION}"`),
      expect.objectContaining({ httpMetadata: { contentType: "application/json; charset=utf-8" } }),
    );
    await expect(response.json()).resolves.toEqual({
      sourceRevision: SOURCE_REVISION,
      backupKey: `backups/deployments/${SOURCE_REVISION}.zip`,
      checksumKey: `backups/deployments/${SOURCE_REVISION}.zip.sha256`,
      checksum: "c".repeat(64),
      createdAt: NOW.toISOString(),
    });
  });

  it("replays the stored receipt without creating another backup", async () => {
    const priorRecord = {
      sourceRevision: SOURCE_REVISION,
      bookmark: "00000000-0000002a",
      backupKey: `backups/deployments/${SOURCE_REVISION}.zip`,
      checksumKey: `backups/deployments/${SOURCE_REVISION}.zip.sha256`,
      checksum: "d".repeat(64),
      createdAt: NOW.toISOString(),
    };
    const harness = createHarness(priorRecord);
    const response = await harness.request();

    expect(response.status).toBe(200);
    expect(harness.dependencies.createPortableBackup).not.toHaveBeenCalled();
    expect(harness.put).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      sourceRevision: SOURCE_REVISION,
      checksum: "d".repeat(64),
    });
  });
});
