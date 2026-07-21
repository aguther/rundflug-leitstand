import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

describe("serverseitige Sitzungsautorisierung (ADR-0010, Q-SIC-020, T-020)", () => {
  it("disables legacy device-header authentication outside development", () => {
    const helper = workerSource.slice(
      workerSource.indexOf("async function authorizeDevice("),
      workerSource.indexOf("function eventCoordinatorNamespace"),
    );
    expect(helper).toContain("authorizeSession(env, request)");
    expect(helper).toContain('if (env.APP_ENV !== "development") return null');
    expect(helper.indexOf('if (env.APP_ENV !== "development")')).toBeLessThan(
      helper.indexOf('request.headers.get("x-device-id")'),
    );
  });

  it("derives Assist ownership from the authorized session actor", () => {
    const route = workerSource.slice(
      workerSource.indexOf('app.on("PUT", eventRoutes("/assist-claims/:aircraftId")'),
      workerSource.indexOf('app.on("DELETE", eventRoutes("/assist-claims/:aircraftId")'),
    );
    expect(route).toContain("const actor = await authorizeSession");
    expect(route).toContain('headers.set("x-operator-account-id", actor.accountId)');
    expect(route).toContain('headers.set("x-operator-login-code", actor.loginCode)');
    expect(route).not.toContain('context.req.header("x-device-id")');
  });

  it("removes browser device credentials and injects the session origin into commands", () => {
    const route = workerSource.slice(
      workerSource.indexOf('app.on("POST", eventRoutes("/commands")'),
      workerSource.indexOf("app.notFound"),
    );
    expect(route).toContain('"x-device-id"');
    expect(route).toContain('"x-device-token"');
    expect(route).toContain("deviceId: actor.deviceId");
  });
});
