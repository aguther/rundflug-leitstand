import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./master-data.css", import.meta.url), "utf8");

describe("master data layout", () => {
  it("sizes the desktop search flex item and lets its inner field fill the available width", () => {
    expect(styles).toMatch(
      /\.master-data-unified-toolbar > \.ds-search-control \{[\s\S]*?width: min\(420px, 100%\);[\s\S]*?flex: 0 1 420px;/,
    );
    expect(styles).toMatch(
      /\.master-data-unified-toolbar > \.ds-search-control \.ds-search-field \{[\s\S]*?width: 100%;/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.master-data-unified-toolbar > \.ds-search-control \{[\s\S]*?width: 100%;/,
    );
  });

  it("keeps the shared toolbar and resource status filter on stable control geometry", () => {
    expect(styles).toMatch(/\.master-data-unified-toolbar \{[\s\S]*?padding: 13px 16px 14px;/);
    expect(styles).toMatch(
      /\.master-data-status-filter \{[\s\S]*?display: inline-flex;[\s\S]*?gap: 12px;/,
    );
    expect(styles).toMatch(
      /\.master-data-status-filter select \{[\s\S]*?height: 44px;[\s\S]*?min-height: 44px;/,
    );
  });
});
