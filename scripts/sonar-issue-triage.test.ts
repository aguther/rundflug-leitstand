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

describe("Sonar issue triage exclusions", () => {
  it("publishes the application version used by the previous-version baseline", () => {
    expect(property("sonar.projectVersion")).toBe(packageManifest.version);
    expect(property("sonar.projectVersion")).not.toBe("not provided");
  });

  it("measures coverage only for deployed application and package sources", () => {
    expect(property("sonar.sources")).toBe("apps,packages,scripts");
    expect(property("sonar.coverage.exclusions")).toBe("scripts/**");
  });

  it("keeps every false-positive criterion limited to one exact rule and file", () => {
    const criteria = property("sonar.issue.ignore.multicriteria")?.split(",") ?? [];

    expect(criteria).toEqual([
      "migration15",
      "migration36",
      "migration38",
      "migration40",
      "migration68",
      "backupRestore",
    ]);
    for (const criterion of criteria) {
      const ruleKey = property(`sonar.issue.ignore.multicriteria.${criterion}.ruleKey`);
      const resourceKey = property(`sonar.issue.ignore.multicriteria.${criterion}.resourceKey`);
      expect(ruleKey).toMatch(/^[a-z]+:[A-Za-z0-9]+$/);
      expect(resourceKey).toMatch(/^(apps|scripts)\/[A-Za-z0-9_./-]+$/);
      expect(ruleKey).not.toContain("*");
      expect(resourceKey).not.toContain("*");
    }
  });

  it("does not disable issue analysis globally", () => {
    expect(properties).not.toContain("sonar.issue.ignore.allfile");
    expect(properties).not.toContain("ruleKey=*");
  });
});
