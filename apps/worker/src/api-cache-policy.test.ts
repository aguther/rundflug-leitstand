import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

describe("operational API cache policy", () => {
  it("marks every API response as no-store", () => {
    expect(workerSource).toContain('app.use("/api/*"');
    expect(workerSource).toContain('context.header("cache-control", "no-store")');
  });

  it("recovers only an explicitly requested admin device with PIN and rate limiting", () => {
    expect(workerSource).toContain('app.post("/api/admin/events/:eventId/recover-device"');
    expect(workerSource).toContain("ADMIN_RECOVERY_RATE_LIMITER");
    expect(workerSource).toContain("ADMIN_DEVICE_CREDENTIAL_RECOVERED");
    expect(workerSource).toContain("verifyCredential(parsed.data.adminPin");
    expect(workerSource).not.toContain("parsed.data.adminPin, auditPayload");
  });
});
