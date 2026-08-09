import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

describe("serverseitige Sitzungsautorisierung (ADR-0010, Q-SIC-020, T-020)", () => {
  it("removes browser device credentials and injects the session origin into commands", () => {
    const route = workerSource.slice(
      workerSource.indexOf('app.on("POST", eventRoutes("/commands")'),
      workerSource.indexOf("app.notFound"),
    );
    expect(route).toContain('context.get("sessionActor")');
    expect(route).toContain('"x-device-id"');
    expect(route).toContain('"x-device-token"');
    expect(route).toContain("deviceId: actor.deviceId");
  });
});
