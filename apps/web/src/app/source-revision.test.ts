import { describe, expect, it } from "vitest";
import { createSourceRevisionMetadata } from "./source-revision";

describe("source revision presentation metadata", () => {
  it("keeps the complete revision while exposing a seven-character label", () => {
    expect(createSourceRevisionMetadata("0123456789abcdef")).toEqual({
      full: "0123456789abcdef",
      known: true,
      short: "0123456",
    });
  });

  it("presents missing and unknown revisions without a copyable value", () => {
    expect(createSourceRevisionMetadata(undefined)).toEqual({
      full: "unknown",
      known: false,
      short: "unbekannt",
    });
    expect(createSourceRevisionMetadata(" UNKNOWN ").known).toBe(false);
  });
});
