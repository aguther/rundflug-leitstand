import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { createPortableBackup } from "./backup";
import { verifyCredential } from "./crypto";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

interface DeploymentBackupRequest {
  sourceRevision: string;
  bookmark: string;
}

interface DeploymentBackupRecord extends DeploymentBackupRequest {
  backupKey: string;
  checksumKey: string;
  checksum: string;
  createdAt: string;
}

const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/;
const MAXIMUM_BOOKMARK_LENGTH = 512;

const defaultDependencies = {
  createPortableBackup,
  now: () => new Date(),
  verifyCredential,
};

export type DeploymentBackupRouteDependencies = typeof defaultDependencies;

function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

function validRequest(value: unknown): value is DeploymentBackupRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DeploymentBackupRequest>;
  return (
    typeof candidate.sourceRevision === "string" &&
    SOURCE_REVISION_PATTERN.test(candidate.sourceRevision) &&
    typeof candidate.bookmark === "string" &&
    candidate.bookmark.length > 0 &&
    candidate.bookmark.length <= MAXIMUM_BOOKMARK_LENGTH &&
    Array.from(candidate.bookmark).every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
  );
}

function responseBody(record: DeploymentBackupRecord) {
  return {
    sourceRevision: record.sourceRevision,
    backupKey: record.backupKey,
    checksumKey: record.checksumKey,
    checksum: record.checksum,
    createdAt: record.createdAt,
  };
}

export function registerDeploymentBackupRoutes(
  app: WorkerApp,
  dependencyOverrides: Partial<DeploymentBackupRouteDependencies> = {},
): void {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  app.post("/api/internal/deployment-backups", async (context) => {
    const authorized = await dependencies.verifyCredential(
      bearerToken(context.req.header("authorization")),
      context.env.DEPLOYMENT_BACKUP_TOKEN_HASH ?? null,
    );
    if (!authorized) {
      return context.json({ error: { code: "NOT_FOUND", message: "Resource not found." } }, 404);
    }

    const input: unknown = await context.req.json().catch(() => null);
    if (!validRequest(input) || context.req.header("idempotency-key") !== input.sourceRevision) {
      return context.json(
        { error: { code: "INVALID_DEPLOYMENT_BACKUP", message: "Invalid backup request." } },
        400,
      );
    }

    const recordKey = `deployment-records/${input.sourceRevision}.json`;
    const priorObject = await context.env.BACKUPS.get(recordKey);
    if (priorObject) {
      const priorRecord = await priorObject.json<DeploymentBackupRecord>();
      if (priorRecord.sourceRevision === input.sourceRevision) {
        return context.json(responseBody(priorRecord));
      }
      return context.json(
        { error: { code: "DEPLOYMENT_BACKUP_CONFLICT", message: "Backup record conflicts." } },
        409,
      );
    }

    const now = dependencies.now();
    const backupKey = `backups/deployments/${input.sourceRevision}.zip`;
    const backup = await dependencies.createPortableBackup(context.env, now, "PRE_DEPLOY", {
      objectKey: backupKey,
    });
    const record: DeploymentBackupRecord = {
      ...input,
      backupKey: backup.key,
      checksumKey: `${backup.key}.sha256`,
      checksum: backup.checksum,
      createdAt: now.toISOString(),
    };
    await context.env.BACKUPS.put(recordKey, `${JSON.stringify(record)}\n`, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        sourceRevision: input.sourceRevision,
        backupKey: backup.key,
        checksumKey: record.checksumKey,
      },
    });
    return context.json(responseBody(record), 201);
  });
}
