import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectWorkerSqlOracleFiles,
  verifyWorkerSqlTestOracles,
} from "./verify_worker_sql_test_oracles.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Worker SQL test oracle audit", () => {
  it("keeps all 36 families behavior-backed with an empty priority-A backlog", async () => {
    await expect(verifyWorkerSqlTestOracles()).resolves.toEqual({
      auditedFiles: 36,
      behaviorBackedFiles: 36,
      priorityAFiles: 0,
    });
  });

  it("detects a new service family that asserts prepared SQL text", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "sql-oracle-ratchet-"));
    temporaryDirectories.push(repositoryRoot);
    const sourceRoot = join(repositoryRoot, "apps", "worker", "src");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(
      join(sourceRoot, "new-command-service.test.ts"),
      'expect(statement.sql).toContain("UPDATE operation_days");\n',
    );

    await expect(collectWorkerSqlOracleFiles(repositoryRoot)).resolves.toEqual([
      "apps/worker/src/new-command-service.test.ts",
    ]);
  });
});
