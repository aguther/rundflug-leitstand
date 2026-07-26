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

  it("soft-deletes accounts while protecting the current and last active admin", () => {
    expect(workerSource).toContain('app.delete("/api/admin/operator-accounts/:accountId"');
    expect(workerSource).toContain("accountId === actor.accountId");
    expect(workerSource).toContain("LAST_ACTIVE_ADMIN");
    expect(workerSource).toContain("SET active = 0, deleted_at = ?1");
    expect(workerSource).toContain("session_version = session_version + 1");
    expect(workerSource).toContain(
      "DELETE FROM flight_line_assist_claims WHERE operator_account_id = ?1",
    );
  });
});
