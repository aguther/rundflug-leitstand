import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  extractD1Rows,
  findTimeTravelBookmark,
  withDeploymentSecretsFile,
} from "./cloudflare_deploy.mjs";

describe("Cloudflare deployment parsing", () => {
  it("extracts rows from Wrangler D1 JSON output", () => {
    expect(
      extractD1Rows([{ results: [{ name: "0001.sql" }] }, { results: [{ name: "0002.sql" }] }]),
    ).toEqual([{ name: "0001.sql" }, { name: "0002.sql" }]);
  });

  it("finds a nested D1 Time Travel bookmark", () => {
    expect(findTimeTravelBookmark({ result: { bookmark: "00000000-0000002a" } })).toBe(
      "00000000-0000002a",
    );
  });

  it("provides only the hashed deployment credential and removes the temporary file", async () => {
    const deploymentToken = "synthetic-deployment-token-for-testing";
    let secretsFilePath = "";

    await expect(
      withDeploymentSecretsFile(deploymentToken, async (path) => {
        secretsFilePath = path;
        await expect(readFile(path, "utf8")).resolves.toBe(
          JSON.stringify({
            DEPLOYMENT_BACKUP_TOKEN_HASH: createHash("sha256")
              .update(deploymentToken)
              .digest("hex"),
          }),
        );
        return "deployed";
      }),
    ).resolves.toBe("deployed");

    await expect(access(secretsFilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the temporary deployment credential after a failed deployment", async () => {
    let secretsFilePath = "";

    await expect(
      withDeploymentSecretsFile("synthetic-deployment-token-for-failure", async (path) => {
        secretsFilePath = path;
        throw new Error("synthetic deployment failure");
      }),
    ).rejects.toThrow("synthetic deployment failure");

    await expect(access(secretsFilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
