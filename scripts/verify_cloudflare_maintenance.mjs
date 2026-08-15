import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  verifyCloudflareConfiguration,
  verifyCloudflareToolchain,
  verifyGeneratedCompatibilityDate,
} from "./cloudflare-maintenance.mjs";
import { repositoryRoot } from "./cloudflare-target.mjs";

const argumentsList = process.argv.slice(2);
const allowedArguments = new Set(["--enforce-compatibility-age"]);
const unknownArgument = argumentsList.find((argument) => !allowedArguments.has(argument));
if (unknownArgument) throw new Error(`Unbekanntes Argument: ${unknownArgument}`);

const [config, packageJson, packageLock, generatedTypes] = await Promise.all([
  readFile(resolve(repositoryRoot, "wrangler.jsonc"), "utf8").then(JSON.parse),
  readFile(resolve(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(resolve(repositoryRoot, "package-lock.json"), "utf8").then(JSON.parse),
  readFile(resolve(repositoryRoot, "apps/worker/src/worker-configuration.d.ts"), "utf8"),
]);
const configuration = verifyCloudflareConfiguration(config, {
  enforceCompatibilityAge: argumentsList.includes("--enforce-compatibility-age"),
});
const toolchain = verifyCloudflareToolchain(packageJson, packageLock, generatedTypes);
verifyGeneratedCompatibilityDate(generatedTypes, configuration.compatibilityDate);

const wrangler = resolve(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");
await new Promise((resolvePromise, reject) => {
  const child = spawn(
    process.execPath,
    [
      wrangler,
      "types",
      "--check",
      "--config=wrangler.jsonc",
      "--env-interface=CloudflareBindings",
      "apps/worker/src/worker-configuration.d.ts",
    ],
    { cwd: repositoryRoot, windowsHide: true, stdio: "inherit" },
  );
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) resolvePromise();
    else reject(new Error("Die generierten Worker-Bindings sind nicht aktuell."));
  });
});

process.stdout.write(
  `${JSON.stringify({ status: "ok", ...configuration, ...toolchain, generatedBindings: "current" }, null, 2)}\n`,
);
