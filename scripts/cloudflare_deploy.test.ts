import { describe, expect, it } from "vitest";
import { extractD1Rows, findTimeTravelBookmark } from "./cloudflare_deploy.mjs";

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
});
