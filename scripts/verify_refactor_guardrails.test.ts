import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import biomeConfigRaw from "../biome.json?raw";
import { collectProductionRawImports } from "./verify_refactor_guardrails.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("refactor guardrail source scope", () => {
  it("ignores files outside the explicit production source roots", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "refactor-guardrail-"));
    temporaryDirectories.push(repositoryRoot);
    const sourceDirectory = join(repositoryRoot, "apps", "web", "src");
    const ignoredDirectory = join(
      repositoryRoot,
      ".claude",
      "worktrees",
      "synthetic-agent",
      "apps",
      "web",
      "src",
    );
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(join(repositoryRoot, "packages"), { recursive: true }),
      mkdir(ignoredDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(sourceDirectory, "component.ts"), "export const value = 1;\n"),
      writeFile(
        join(sourceDirectory, "component.test.ts"),
        'import component from "./component.ts?raw";\nvoid component;\n',
      ),
      writeFile(join(ignoredDirectory, "ignored.ts"), "export const ignored = true;\n"),
      writeFile(
        join(ignoredDirectory, "ignored.test.ts"),
        'import ignored from "./ignored.ts?raw";\nvoid ignored;\n',
      ),
      writeFile(join(repositoryRoot, "wrangler.synthetic.generated.jsonc"), "{ invalid jsonc"),
    ]);

    await expect(collectProductionRawImports(repositoryRoot)).resolves.toEqual([
      "apps/web/src/component.test.ts -> apps/web/src/component.ts",
    ]);
  });

  it("excludes generated Wrangler target configurations from Biome", () => {
    const biomeConfig = JSON.parse(biomeConfigRaw) as { files: { includes: string[] } };

    expect(biomeConfig.files.includes).toContain("!wrangler.*.generated.jsonc");
  });
});
