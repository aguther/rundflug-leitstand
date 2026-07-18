import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

describe("authenticated event selection catalog", () => {
  it("requires a valid session and excludes archived events", () => {
    const route = workerSource.slice(
      workerSource.indexOf('app.get("/api/auth/events"'),
      workerSource.indexOf('app.post("/api/auth/logout"'),
    );
    expect(route).toContain("authorizeSession");
    expect(route).toContain("SESSION_REQUIRED");
    expect(route).toContain("WHERE archived_at IS NULL");
    expect(route).toContain("WHEN 'ACTIVE' THEN 0");
    expect(route).not.toContain("paired_devices");
  });
});
