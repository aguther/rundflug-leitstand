import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { repositoryRoot } from "../cloudflare-target.mjs";

const wrangler = resolve(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");

export function runWrangler(argumentsList, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [wrangler, ...argumentsList], {
      cwd: repositoryRoot,
      env: options.accountId
        ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: options.accountId }
        : process.env,
      windowsHide: true,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (options.echo) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (options.echo) process.stderr.write(chunk);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const diagnostic = `${stdout}\n${stderr}`.trim().slice(-4_000);
      reject(
        new Error(
          `${options.label ?? "Wrangler command"} failed with exit code ${code}.${diagnostic ? ` ${diagnostic}` : ""}`,
        ),
      );
    });
  });
}
