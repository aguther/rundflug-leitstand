import { readFileSync } from "node:fs";

const cssImportPattern = /^@import\s+["'](.+?)["'];\s*$/gm;

export function readCssSource(url: URL): string {
  const source = readFileSync(url, "utf8");
  return source.replace(cssImportPattern, (_statement, relativePath: string) =>
    readCssSource(new URL(relativePath, url)),
  );
}
