import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const properties = readFileSync(new URL("../sonar-project.properties", import.meta.url), "utf8");
const packageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

function property(name: string): string | undefined {
  return properties
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

describe("Sonar analysis configuration", () => {
  it("publishes the application version used by the previous-version baseline", () => {
    expect(property("sonar.projectVersion")).toBe(packageManifest.version);
    expect(property("sonar.projectVersion")).not.toBe("not provided");
  });

  it("measures coverage only for deployed application and package sources", () => {
    expect(property("sonar.sources")).toBe("apps,packages,scripts");
    expect(property("sonar.coverage.exclusions")).toBe("scripts/**");
  });

  it("uses the CI Python version and does not classify SQLite as Oracle PL/SQL", () => {
    expect(property("sonar.python.version")).toBe("3.13");
    expect(property("sonar.plsql.file.suffixes")?.split(",")).toEqual([".plsql", ".pkb", ".pks"]);
    expect(property("sonar.plsql.file.suffixes")).not.toContain(".sql,");
    expect(property("sonar.plsql.file.suffixes")).not.toBe(".sql");
  });

  it("keeps binary PWA icons outside source analysis without excluding application code", () => {
    const exclusions = property("sonar.exclusions")?.split(",") ?? [];

    expect(exclusions).toContain("apps/web/public/**/*.png");
    expect(exclusions).not.toContain("apps/**");
    expect(exclusions).not.toContain("packages/**");
  });

  it("keeps every false-positive criterion limited to one exact rule and file", () => {
    const criteria = property("sonar.issue.ignore.multicriteria")?.split(",") ?? [];

    expect(criteria).toEqual(["backupRestore"]);
    for (const criterion of criteria) {
      const ruleKey = property(`sonar.issue.ignore.multicriteria.${criterion}.ruleKey`);
      const resourceKey = property(`sonar.issue.ignore.multicriteria.${criterion}.resourceKey`);
      expect(ruleKey).toMatch(/^[a-z]+:[A-Za-z0-9]+$/);
      expect(resourceKey).toMatch(/^(apps|scripts)\/[A-Za-z0-9_./-]+$/);
      expect(ruleKey).not.toContain("*");
      expect(resourceKey).not.toContain("*");
      expect(ruleKey).not.toMatch(/^plsql:/);
    }
  });

  it("keeps every tracked source-like text file valid UTF-8", () => {
    const trackedFiles = execFileSync("git", ["ls-files", "apps", "packages", "scripts"], {
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((path) =>
        /\.(?:c?js|mjs|mts|py|sql|css|html|json|webmanifest|ya?ml|md|txt|toml|properties|svg|ps1|cmd|sh|tsx?)$/i.test(
          path,
        ),
      );
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const invalidFiles: string[] = [];

    for (const path of trackedFiles) {
      try {
        decoder.decode(readFileSync(new URL(`../${path}`, import.meta.url)));
      } catch {
        invalidFiles.push(path);
      }
    }

    expect(invalidFiles).toEqual([]);
  });

  it("does not disable issue analysis globally", () => {
    expect(properties).not.toContain("sonar.issue.ignore.allfile");
    expect(properties).not.toContain("ruleKey=*");
  });
});
