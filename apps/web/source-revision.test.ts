import { describe, expect, it, vi } from "vitest";
import { resolveSourceRevision } from "./source-revision";

describe("source revision build metadata", () => {
  it("prefers the configured CI revision without reading Git", () => {
    const readGitRevision = vi.fn(() => "local-revision");

    expect(resolveSourceRevision(" ci-revision ", readGitRevision)).toBe("ci-revision");
    expect(readGitRevision).not.toHaveBeenCalled();
  });

  it("uses the local Git revision when no configured revision exists", () => {
    expect(resolveSourceRevision(undefined, () => " local-revision\n")).toBe("local-revision");
  });

  it("uses the stable unknown fallback when Git metadata is unavailable", () => {
    expect(
      resolveSourceRevision("  ", () => {
        throw new Error("Git is unavailable");
      }),
    ).toBe("unknown");
    expect(resolveSourceRevision(undefined, () => "  ")).toBe("unknown");
  });
});
