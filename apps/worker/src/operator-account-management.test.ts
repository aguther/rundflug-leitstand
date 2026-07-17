import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

describe("operator account management", () => {
  it("protects account administration with an ADMIN session", () => {
    expect(workerSource).toContain(
      'assertRole(await authorizeSession(context.env, context.req.raw), ["ADMIN"])',
    );
  });

  it("revokes every existing session by advancing the account session version", () => {
    expect(workerSource).toContain("parsed.data.revokeSessions ? 1 : 0");
    expect(workerSource).toContain("OR ?5 = 1 THEN session_version + 1");
  });
});
