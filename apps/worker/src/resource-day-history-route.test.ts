import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

describe("resource day history route", () => {
  const route = workerSource.slice(
    workerSource.indexOf('app.on("GET", eventRoutes("/history/resources")'),
    workerSource.indexOf('app.on("GET", eventRoutes("/devices")'),
  );

  it("is read-only and limited to Flight Director and administration", () => {
    expect(route).toContain('["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)');
    expect(route).toContain("resourceDayHistoryQuerySchema.safeParse");
    expect(route).not.toContain(".run()");
    expect(route).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("returns anonymous operational codes without reasons, notes or tokens", () => {
    expect(route).toContain("pilotOperationalCode: row.pilot_operational_code");
    expect(route).not.toMatch(/reason|note|public_code|token|payload_json/i);
  });
});
