import { describe, expect, it } from "vitest";

const migrations = import.meta.glob("../migrations/*.sql", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const forbiddenIdentityColumn =
  /^\s*(guest_?name|passenger_?name|customer_?name|phone(_number)?|telephone(_number)?|telefon(_nummer)?|mobile(_number)?|email(_address)?)\s+/im;

describe("anonymous V1 database schema", () => {
  it("keeps every migration free of guest names and telephone contact fields", () => {
    const violations = Object.entries(migrations)
      .filter(([, sql]) => forbiddenIdentityColumn.test(sql))
      .map(([path]) => path);

    expect(Object.keys(migrations).length).toBeGreaterThanOrEqual(31);
    expect(violations).toEqual([]);
  });

  it("stores public ticket codes only as hashes", () => {
    const completeSchema = Object.values(migrations).join("\n");

    expect(completeSchema).toContain("public_code_hash TEXT NOT NULL UNIQUE");
    expect(completeSchema).not.toMatch(/^\s*public_code\s+TEXT/im);
  });
});
