import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import biomeConfigRaw from "../biome.json?raw";
import {
  collectDomainExternalImports,
  collectInternalDomainBarrelImports,
  collectProductionRawImports,
  collectProductionSourceReads,
  collectPythonProductionSourceReads,
} from "./verify_refactor_guardrails.mjs";

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

  it("reports tests that read production TypeScript as file content", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "source-read-guardrail-"));
    temporaryDirectories.push(repositoryRoot);
    const sourceDirectory = join(repositoryRoot, "apps", "worker", "src");
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(join(repositoryRoot, "packages"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(sourceDirectory, "service.ts"), "export const value = 1;\n"),
      writeFile(
        join(sourceDirectory, "service.test.ts"),
        'const source = readFileSync(new URL("./service.ts", import.meta.url), "utf8");\nvoid source;\n',
      ),
    ]);

    await expect(collectProductionSourceReads(repositoryRoot)).resolves.toEqual([
      "apps/worker/src/service.test.ts -> apps/worker/src/service.ts",
    ]);
  });

  it("covers JavaScript production logic and literal Python source reads", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "source-language-guardrail-"));
    temporaryDirectories.push(repositoryRoot);
    const sourceDirectory = join(repositoryRoot, "apps", "worker", "src");
    const scriptDirectory = join(repositoryRoot, "scripts");
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(join(repositoryRoot, "packages"), { recursive: true }),
      mkdir(scriptDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(sourceDirectory, "runtime.mjs"), "export const value = 1;\n"),
      writeFile(
        join(sourceDirectory, "runtime.test.ts"),
        'import runtime from "./runtime.mjs?raw";\nvoid runtime;\n',
      ),
      writeFile(
        join(scriptDirectory, "verify.py"),
        '(ROOT / "apps/worker/src/runtime.mjs").read_text(encoding="utf-8")\n',
      ),
    ]);

    await expect(collectProductionRawImports(repositoryRoot)).resolves.toEqual([
      "apps/worker/src/runtime.test.ts -> apps/worker/src/runtime.mjs",
    ]);
    await expect(collectPythonProductionSourceReads(repositoryRoot)).resolves.toEqual([
      "scripts/verify.py -> apps/worker/src/runtime.mjs",
    ]);
  });

  it("reports production modules that import the public domain barrel", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "domain-barrel-guardrail-"));
    temporaryDirectories.push(repositoryRoot);
    const domainSource = join(repositoryRoot, "packages", "domain", "src");
    await mkdir(join(domainSource, "nested"), { recursive: true });
    await Promise.all([
      writeFile(join(domainSource, "index.ts"), "export const value = 1;\n"),
      writeFile(join(domainSource, "direct.ts"), 'import { value } from "./index";\nvoid value;\n'),
      writeFile(
        join(domainSource, "nested", "indirect.ts"),
        'import { value } from "../index.ts";\nvoid value;\n',
      ),
      writeFile(
        join(domainSource, "allowed.test.ts"),
        'import { value } from "./index";\nvoid value;\n',
      ),
    ]);

    await expect(collectInternalDomainBarrelImports(repositoryRoot)).resolves.toEqual([
      "packages/domain/src/direct.ts",
      "packages/domain/src/nested/indirect.ts",
    ]);
  });

  it("reports external adapter imports in the pure domain package", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "domain-external-guardrail-"));
    temporaryDirectories.push(repositoryRoot);
    const domainSource = join(repositoryRoot, "packages", "domain", "src");
    await mkdir(domainSource, { recursive: true });
    await Promise.all([
      writeFile(
        join(domainSource, "allowed.ts"),
        'import { value } from "./value";\nvoid value;\n',
      ),
      writeFile(join(domainSource, "forbidden.ts"), 'import { Hono } from "hono";\nvoid Hono;\n'),
    ]);

    await expect(collectDomainExternalImports(repositoryRoot)).resolves.toEqual([
      "packages/domain/src/forbidden.ts -> hono",
    ]);
  });
});
